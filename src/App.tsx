import React, { useState, useCallback } from 'react';
import { UploadCloud, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [splitSelector, setSplitSelector] = useState('h1, p[class*="Chapter_No_"]');

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setError(null);
    setSuccess(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndSetFile(droppedFile);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccess(false);
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    const isDocx = selectedFile.name.toLowerCase().endsWith('.docx');
    const isEpub = selectedFile.name.toLowerCase().endsWith('.epub');
    if (isDocx || isEpub) {
      setFile(selectedFile);
    } else {
      setError('Please upload a valid .docx or .epub file.');
      setFile(null);
    }
  };

  const handleConvert = async () => {
    if (!file) return;
    setConverting(true);
    setError(null);
    setSuccess(false);
    
    try {
      const { processFileToEpub } = await import('./lib/converter');
      await processFileToEpub(file, splitSelector);
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError('Failed to convert file. ' + (err.message || 'Unknown error occurred.'));
    } finally {
      setConverting(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setError(null);
    setSuccess(false);
    setConverting(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4 text-yellow-500 drop-shadow-sm">
            Epub Converter <br />
            <span className="text-white text-3xl md:text-4xl mt-2 block">by อาจารย์อั๋น</span>
          </h1>
          <p className="text-gray-400 text-base md:text-lg max-w-2xl mx-auto">
            คุณสามารถอัพโหลดไฟล์ Doc, Docx (Microsoft Word) หรือ ไฟล์ epub จาก Google doc หรือ ไฟล์ epub จาก Affinity (แบบ Reflow) ได้
          </p>
        </div>

        {/* Upload Card */}
        <div className="bg-[#1c1d21] border border-[#2d2e34] p-8 rounded-3xl shadow-2xl transition-all duration-300 hover:shadow-yellow-900/10">
          
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center transition-colors
              ${isDragging ? 'border-yellow-500 bg-yellow-500/10' : 'border-[#3d3e45] hover:border-yellow-500/50 hover:bg-[#25262b]'}
              ${file ? 'border-green-500/50 bg-green-500/5' : ''}
            `}
          >
            <input 
              type="file" 
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.epub,application/epub+zip" 
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            
            {file ? (
              <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                <FileText className="w-16 h-16 text-green-400 mb-4" />
                <h3 className="text-xl font-semibold text-slate-200">{file.name}</h3>
                <p className="text-slate-400 mt-2 text-sm">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                <p className="text-yellow-500 mt-4 text-sm font-medium">Click or drag to change file</p>
              </div>
            ) : (
              <div className="flex flex-col items-center pointer-events-none">
                <div className="bg-[#2a2b30] p-4 rounded-full mb-4 shadow-inner">
                  <UploadCloud className="w-10 h-10 text-yellow-500" />
                </div>
                <h3 className="text-xl font-semibold text-slate-200 mb-2">Upload your document</h3>
                <p className="text-slate-400 text-sm">Drag and drop your .docx or .epub file here, or click to browse</p>
              </div>
            )}
          </div>

          {/* Advanced Settings */}
          {file && (
            <div className="mt-6 text-left animate-in fade-in duration-300">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Chapter Split Selector (CSS)
              </label>
              <div className="flex flex-col gap-1">
                <input 
                  type="text" 
                  value={splitSelector}
                  onChange={(e) => setSplitSelector(e.target.value)}
                  className="w-full bg-[#141518] border border-[#3d3e45] text-slate-200 text-sm rounded-lg focus:ring-yellow-500 focus:border-yellow-500 block p-3"
                  placeholder="e.g. h1, p[class*='Chapter_No_']"
                />
                <p className="text-xs text-slate-500 px-1 mt-1">
                  Define which elements create a new chapter page. Use any standard CSS selector.
                </p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-6 flex items-center p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 animate-in slide-in-from-bottom-2">
              <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mt-6 flex items-center p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 animate-in slide-in-from-bottom-2">
              <CheckCircle className="w-5 h-5 mr-3 flex-shrink-0" />
              <p className="text-sm font-medium">Conversion successful! Your EPUB should start downloading.</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-8 flex gap-4">
            <button
              onClick={handleConvert}
              disabled={!file || converting}
              className={`flex-1 py-4 px-6 rounded-xl font-bold text-lg flex justify-center items-center transition-all duration-300
                ${!file || converting 
                  ? 'bg-[#2a2b30] text-gray-500 cursor-not-allowed border border-[#3d3e45]'
                  : 'bg-yellow-500 text-black shadow-lg hover:shadow-yellow-500/20 transform hover:-translate-y-0.5 hover:bg-yellow-400'
                }
              `}
            >
              {converting ? (
                <>
                  <Loader2 className="w-6 h-6 mr-3 animate-spin text-black" />
                  Converting...
                </>
              ) : (
                'Convert Now'
              )}
            </button>

            {file && (
              <button
                onClick={handleClear}
                disabled={converting}
                className={`py-4 px-8 rounded-xl font-semibold text-lg flex justify-center items-center transition-all duration-300
                  ${converting 
                    ? 'bg-[#141518] text-gray-600 cursor-not-allowed border border-[#2d2e34]'
                    : 'bg-[#141518] text-gray-300 hover:bg-[#25262b] border border-[#3d3e45] hover:text-white hover:border-yellow-500/50'
                  }
                `}
              >
                Clear File
              </button>
            )}
          </div>
        </div>
        
        <p className="text-center text-gray-500 mt-8 text-sm">
          All conversions happen directly in your browser. Your files are completely secure and never uploaded to any server.
        </p>
      </div>
    </div>
  );
}

export default App;
