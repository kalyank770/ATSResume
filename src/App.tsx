/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, type ChangeEvent } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, FileText, Image as ImageIcon, Loader2, Download, Printer, AlertCircle } from 'lucide-react';

export default function App() {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resumeInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>, type: 'resume' | 'template') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'resume') {
      setResumeFile(file);
    } else {
      setTemplateFile(file);
    }
    setError(null);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleGenerate = async () => {
    if (!resumeFile || !templateFile) {
      setError('Please upload both a resume and a template image.');
      return;
    }

    const apiKey =
      (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ||
      (process.env.GEMINI_API_KEY as string | undefined);
    const model = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) || 'gemini-2.5-flash';

    if (!apiKey) {
      setError(
        'Missing Gemini API key. Create ATSResume/.env.local with GEMINI_API_KEY=your_key (or VITE_GEMINI_API_KEY=your_key), then restart npm run dev.'
      );
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedHtml(null);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const resumeBase64 = await fileToBase64(resumeFile);
      const templateBase64 = await fileToBase64(templateFile);

      const prompt = `I am providing two files:
1. My current resume (document or image).
2. A template design (image).

Your task is to extract all the text and information from my resume, and then write a complete, single-file HTML document that perfectly replicates the visual design, layout, typography, and color scheme of the template image, populated with my information.

CRITICAL REQUIREMENTS:
- Output ONLY valid HTML code. Do NOT wrap it in markdown blocks (no \`\`\`html).
- Use embedded CSS (<style>) for all styling. Do NOT use external CSS frameworks.
- Ensure the layout is optimized for an A4/Letter portrait aspect ratio (e.g., 210mm width, 297mm height).
- Use standard web-safe fonts or import Google Fonts that match the template.
- Ensure good contrast and professional spacing.
- Include all relevant sections from my resume (Experience, Education, Skills, etc.) adapting them to fit the template's structure.
- Ensure the background colors and structural elements (columns, headers, dividers) match the template exactly.
- Make sure the HTML is completely self-contained.`;

      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { data: resumeBase64, mimeType: resumeFile.type } },
            { inlineData: { data: templateBase64, mimeType: templateFile.type } },
            { text: prompt }
          ]
        }
      });

      let html = response.text || '';
      // Clean up markdown formatting if the model still includes it
      html = html.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
      
      setGeneratedHtml(html);
    } catch (err: any) {
      console.error('Generation error:', err);
      const message = String(err?.message || '');
      if (message.includes('RESOURCE_EXHAUSTED') || message.includes('quota') || message.includes('429')) {
        setError(
          'Gemini quota exceeded for the selected model. Use a free-tier model by setting VITE_GEMINI_MODEL=gemini-2.5-flash in ATSResume/.env.local, wait for quota reset, or upgrade billing in Google AI Studio.'
        );
      } else {
        setError(err.message || 'An error occurred while generating the resume.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Header - Hidden during print */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 print:hidden">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">Resume Redesigner</h1>
          </div>
          <p className="text-sm text-gray-500 hidden sm:block">
            Transform your resume to match any template
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 print:p-0">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Controls - Hidden during print */}
          <div className="lg:col-span-4 space-y-6 print:hidden">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold mb-4">1. Upload Content</h2>
              
              {/* Resume Upload */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Current Resume (PDF or Image)
                </label>
                <div 
                  onClick={() => resumeInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    resumeFile ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <input 
                    type="file" 
                    ref={resumeInputRef}
                    className="hidden" 
                    accept=".pdf,image/*"
                    onChange={(e) => handleFileChange(e, 'resume')}
                  />
                  {resumeFile ? (
                    <div className="flex flex-col items-center">
                      <FileText className="h-8 w-8 text-blue-500 mb-2" />
                      <span className="text-sm font-medium text-blue-700 truncate w-full px-4">
                        {resumeFile.name}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <Upload className="h-8 w-8 text-gray-400 mb-2" />
                      <span className="text-sm text-gray-500">Click to upload resume</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Template Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Template Design (Image)
                </label>
                <div 
                  onClick={() => templateInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    templateFile ? 'border-purple-400 bg-purple-50' : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <input 
                    type="file" 
                    ref={templateInputRef}
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, 'template')}
                  />
                  {templateFile ? (
                    <div className="flex flex-col items-center">
                      <ImageIcon className="h-8 w-8 text-purple-500 mb-2" />
                      <span className="text-sm font-medium text-purple-700 truncate w-full px-4">
                        {templateFile.name}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <Upload className="h-8 w-8 text-gray-400 mb-2" />
                      <span className="text-sm text-gray-500">Click to upload template</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-start gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={isGenerating || !resumeFile || !templateFile}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Generating Resume...
                </>
              ) : (
                <>
                  <FileText className="h-5 w-5" />
                  Generate Resume
                </>
              )}
            </button>

            {generatedHtml && (
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg mt-4">
                <h3 className="font-medium text-blue-900 mb-2">Ready to Download!</h3>
                <p className="text-sm text-blue-700 mb-4">
                  Review your generated resume on the right. If it looks good, you can save it as a PDF.
                </p>
                <button
                  onClick={handlePrint}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Printer className="h-4 w-4" />
                  Print / Save as PDF
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Preview */}
          <div className="lg:col-span-8">
            <div className="bg-gray-200/50 rounded-xl p-4 sm:p-8 min-h-[800px] flex justify-center overflow-x-auto border border-gray-200 print:p-0 print:border-none print:bg-transparent">
              {generatedHtml ? (
                <div 
                  id="printable-resume"
                  className="bg-white shadow-2xl print:shadow-none"
                  style={{ 
                    width: '210mm', 
                    minHeight: '297mm',
                    // Scale down slightly on smaller screens for preview, but keep actual dimensions
                    transformOrigin: 'top center',
                  }}
                  dangerouslySetInnerHTML={{ __html: generatedHtml }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-400 h-full print:hidden">
                  <FileText className="h-16 w-16 mb-4 opacity-20" />
                  <p className="text-lg font-medium">Preview will appear here</p>
                  <p className="text-sm mt-2">Upload your files and click Generate</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
