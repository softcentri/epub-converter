import mammoth from 'mammoth';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

async function extractHtmlFromEpub(file: File): Promise<string> {
  const zip = new JSZip();
  await zip.loadAsync(file);
  
  // 1. Find container.xml
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Invalid EPUB: Missing META-INF/container.xml");
  
  // 2. Parse container to find OPF path
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'application/xml');
  const rootfile = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfile) throw new Error("Invalid EPUB: Missing rootfile in container.xml");
  
  // 3. Parse OPF
  const opfXml = await zip.file(rootfile)?.async("string");
  if (!opfXml) throw new Error("Invalid EPUB: Missing OPF file");
  // Some standard namespaces might prevent querySelector, 'text/xml' is safer for OPF
  const opfDoc = parser.parseFromString(opfXml, 'text/xml');
  
  // 4. Find spine and manifest
  const spineItems = Array.from(opfDoc.querySelectorAll('spine itemref, itemref'));
  const manifestItems = Array.from(opfDoc.querySelectorAll('manifest item, item'));
  
  const opfDir = rootfile.includes('/') ? rootfile.substring(0, rootfile.lastIndexOf('/') + 1) : '';
  
  // 5. Extract HTML in spine order
  let fullHtml = '';
  for (const itemRef of spineItems) {
    const idref = itemRef.getAttribute('idref');
    const manifestItem = manifestItems.find(item => item.getAttribute('id') === idref);
    if (manifestItem) {
      const href = manifestItem.getAttribute('href');
      if (href) {
        // Handle URL decoding if paths contain spaces
        const filePath = opfDir + decodeURIComponent(href);
        const fileContent = await zip.file(filePath)?.async("string");
        if (fileContent) {
          // Use text/html to be more tolerant of poorly formed XHTML
          const htmlDoc = parser.parseFromString(fileContent, 'text/html');
          const body = htmlDoc.querySelector('body');
          if (body) {
            fullHtml += body.innerHTML;
          } else {
            // If body tag fails due to poor XML, just extract raw content heuristically
            fullHtml += fileContent.replace(/<head>[\s\S]*?<\/head>/i, '').replace(/<\/?(html|body)[^>]*>/gi, '');
          }
        }
      }
    }
  }
  
  return fullHtml;
}

/**
 * Converts a given DOCX or existing EPUB file to a fixed EPUB file and triggers download.
 * @param file The DOCX or EPUB file to convert.
 */
export async function processFileToEpub(file: File, splitSelector: string = 'h1'): Promise<void> {
  let htmlContent = '';
  const isEpub = file.name.toLowerCase().endsWith('.epub');

  if (isEpub) {
    htmlContent = await extractHtmlFromEpub(file);
  } else {
    // 1. Convert DOCX to HTML using mammoth
    const arrayBuffer = await file.arrayBuffer();
    
    // Custom style map to ensure headings and basic formatting are preserved well
    const options = {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ]
    };

    const result = await mammoth.convertToHtml({ arrayBuffer }, options);
    htmlContent = result.value;
  }

  // --- Chapter Splitting Logic ---
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  
  interface Chapter {
    title: string;
    id: string;
    contentHtml: string;
  }
  
  const chapters: Chapter[] = [];
  let splitElements: Element[] = [];
  
  try {
    if (splitSelector) {
      splitElements = Array.from(doc.querySelectorAll(splitSelector));
    }
  } catch (e) {
    // Fallback if selector is invalid
    splitElements = Array.from(doc.querySelectorAll('h1'));
  }

  // Filter out elements that are just TOC links to avoid false positives
  splitElements = splitElements.filter(el => {
    if (el.closest('nav')) return false;
    const className = (el.getAttribute('class') || '').toLowerCase();
    if (className.includes('toc')) return false; // TOC entries
    return true;
  });

  if (splitElements.length > 0) {
    // Insert unique markers before every chapter header
    splitElements.forEach((el, index) => {
      const marker = doc.createComment(`EPUB_SPLIT_${index}`);
      el.parentNode?.insertBefore(marker, el);
    });

    const fullHtmlStr = doc.body.innerHTML;
    
    // Extract frontmatter (content before the first split)
    const firstSplitIndex = fullHtmlStr.indexOf('<!--EPUB_SPLIT_0-->');
    let chapterStartIndex = 1;
    
    if (firstSplitIndex > 0) {
      const frontmatterHtml = fullHtmlStr.substring(0, firstSplitIndex);
      // Only add frontmatter if it contains actual content
      if (frontmatterHtml.replace(/<[^>]*>/g, '').trim().length > 0) {
        chapters.push({
          title: "Frontmatter",
          id: "chapter-0",
          contentHtml: frontmatterHtml
        });
      }
    }
    
    // Extract each chapter
    for (let i = 0; i < splitElements.length; i++) {
      const marker = `<!--EPUB_SPLIT_${i}-->`;
      const nextMarker = `<!--EPUB_SPLIT_${i+1}-->`;
      
      const startIdx = fullHtmlStr.indexOf(marker) + marker.length;
      let endIdx = fullHtmlStr.indexOf(nextMarker);
      if (endIdx === -1) endIdx = fullHtmlStr.length;
      
      const chunkHtml = fullHtmlStr.substring(startIdx, endIdx);
      const title = splitElements[i].textContent?.trim() || `Chapter ${i+1}`;
      
      chapters.push({
        title,
        id: `chapter-${chapterStartIndex}`,
        contentHtml: chunkHtml
      });
      chapterStartIndex++;
    }
  } else {
    // No matches found, put everything in single chapter
    chapters.push({
      title: "Content",
      id: "chapter-1",
      contentHtml: htmlContent
    });
  }

  // 2. Generate EPUB structure using JSZip
  const zip = new JSZip();

  zip.file("mimetype", "application/epub+zip");

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.file("META-INF/container.xml", containerXml);

  const title = file.name.replace(/\.(docx?|epub)$/i, '') + (isEpub ? ' (Fixed)' : '');
  const bookId = crypto.randomUUID();

  // OEBPS/content.opf
  let manifestItems = `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`;
  let spineItems = ``;
  let navOlItems = ``;
  
  chapters.forEach((chapter) => {
    manifestItems += `\n    <item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`;
    spineItems += `\n    <itemref idref="${chapter.id}"/>`;
    navOlItems += `\n        <li><a href="${chapter.id}.xhtml">${chapter.title}</a></li>`;
  });

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:${bookId}</dc:identifier>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;
  zip.file("OEBPS/content.opf", contentOpf);

  // OEBPS/nav.xhtml (EPUB 3 Navigation Document)
  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Table of Contents</title>
  <meta charset="utf-8"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>${navOlItems}
    </ol>
  </nav>
</body>
</html>`;
  zip.file("OEBPS/nav.xhtml", navXhtml);

  // OEBPS/toc.ncx
  let navPoints = ``;
  chapters.forEach((chapter, index) => {
    navPoints += `
    <navPoint id="navPoint-${index + 1}" playOrder="${index + 1}">
      <navLabel>
        <text>${chapter.title}</text>
      </navLabel>
      <content src="${chapter.id}.xhtml"/>
    </navPoint>`;
  });

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${title}</text>
  </docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`;
  zip.file("OEBPS/toc.ncx", tocNcx);

  // Add all chapter files
  chapters.forEach((chapter) => {
    const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${chapter.title}</title>
  <meta charset="utf-8"/>
  <style>
    body { font-family: sans-serif; line-height: 1.6; padding: 1em; }
    h1, h2, h3 { color: #333; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  ${chapter.contentHtml}
</body>
</html>`;
    zip.file(`OEBPS/${chapter.id}.xhtml`, xhtmlContent);
  });

  // 3. Generate the ZIP file and trigger download
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  
  // Use file-saver to download the blob
  saveAs(blob, `${title}.epub`);
}
