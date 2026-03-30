/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, type ChangeEvent } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, FileText, Image as ImageIcon, Loader2, Download, Printer, AlertCircle, Code, Eye } from 'lucide-react';

const MAX_QUOTA_RETRIES = 1;
const TARGET_MODEL_DISPLAY_NAME = 'Gemma 3 27B';
const TARGET_MODEL_API_IDS = ['gemma-3-27b-it'];
const SYSTEM_INSTRUCTION = 'You are an expert frontend developer. Your goal is to write pixel-perfect HTML and CSS that exactly matches the provided design template, using the provided resume content. Output ONLY raw HTML.';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const extractErrorMessage = (err: unknown): string => {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

const isQuotaExceededError = (message: string): boolean => {
  return /resource_exhausted|quota exceeded|status.?"?\s*:\s*"?resource_exhausted|\b429\b/i.test(message);
};

const extractRetryDelayMs = (message: string): number | null => {
  const retryInSeconds = message.match(/retry in\s+([\d.]+)s/i);
  if (retryInSeconds?.[1]) {
    return Math.ceil(Number(retryInSeconds[1]) * 1000);
  }

  const retryDelayField = message.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (retryDelayField?.[1]) {
    return Math.ceil(Number(retryDelayField[1]) * 1000);
  }

  return null;
};

const normalizeModelName = (modelName?: string): string => {
  if (!modelName) return '';

  const trimmed = modelName.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('models/')) {
    return trimmed.slice('models/'.length);
  }

  const modelsSegment = /\/models\/([^/]+)$/i.exec(trimmed);
  if (modelsSegment?.[1]) {
    return modelsSegment[1];
  }

  const slashParts = trimmed.split('/').filter(Boolean);
  if (slashParts.length > 0) {
    return slashParts[slashParts.length - 1];
  }

  return trimmed;
};

const isTargetModel = (name?: string, displayName?: string): boolean => {
  const normalizedName = normalizeModelName(name);
  const normalizedDisplayName = (displayName || '').trim().toLowerCase();

  return normalizedDisplayName === TARGET_MODEL_DISPLAY_NAME.toLowerCase() || TARGET_MODEL_API_IDS.includes(normalizedName.toLowerCase());
};

const isValidGeminiModelId = (modelId: string): boolean => {
  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(modelId);
};

const getModelFormatCandidates = (modelId: string): string[] => {
  return [
    modelId,
    `models/${modelId}`,
    `google/${modelId}`,
    `publishers/google/models/${modelId}`,
  ];
};

const supportsDeveloperInstruction = (modelName: string): boolean => {
  return !/gemma/i.test(modelName);
};

const formatGenerationError = (err: unknown): string => {
  const message = extractErrorMessage(err);

  if (isQuotaExceededError(message)) {
    const retryMs = extractRetryDelayMs(message);
    const retryText = retryMs ? ` Wait about ${Math.ceil(retryMs / 1000)} seconds and try again.` : '';

    return `Gemini quota is exhausted for the current key/project.${retryText} If it keeps failing, check Google AI Studio quota limits and billing, or use a model with available quota (for example gemini-2.5-flash).`;
  }

  if (/api key|unauthenticated|permission denied|forbidden|401|403/i.test(message)) {
    return 'Gemini authentication failed. Verify GEMINI_API_KEY in your .env.local and ensure that key has access to the selected model.';
  }

  if (/generatecontentrequest\.model|unexpected model name format/i.test(message)) {
    return 'Invalid model name format for the selected Gemma model. The app is now trying multiple valid Gemma model formats automatically.';
  }

  return message || 'An error occurred while generating the resume.';
};

export default function App() {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');

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

    setIsGenerating(true);
    setError(null);
    setGeneratedHtml(null);
    setActiveTab('preview');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const resumeBase64 = await fileToBase64(resumeFile);
      const templateBase64 = await fileToBase64(templateFile);

      const prompt = `You are an expert frontend developer and UI/UX designer.
I am providing two files:
1. My current resume (document or image).
2. A template design (image).

Your task is to create a PIXEL-PERFECT HTML/CSS replica of the template design, but populated with the real information from my resume.

CRITICAL REQUIREMENTS:
1. VISUAL CLONE: The output must look EXACTLY like the template image. Extract and use the exact background colors, text colors, font sizes, and font weights.
2. LAYOUT: Use modern CSS (Flexbox/Grid) to perfectly replicate the columns, margins, padding, and alignment of the template. Pay close attention to the spacing between sections.
3. TYPOGRAPHY: Import matching Google Fonts (e.g., Roboto, Open Sans, Lato, Montserrat) via @import in the CSS to match the template's typography.
4. CONTENT: Use the text from my resume, but format it to fit the template's structure. If the template has a specific way of showing skills (e.g., progress bars, tags), replicate that visual style using HTML/CSS.
5. STYLING: Use embedded CSS (<style>) within the HTML. Do NOT use Tailwind or external CSS frameworks.
6. DIMENSIONS: The layout must be optimized for an A4 portrait aspect ratio (210mm x 297mm). Ensure the content fits well within these dimensions.
7. FORMAT: Output ONLY the raw HTML code. Do NOT wrap it in markdown blocks (no \`\`\`html). Start directly with <!DOCTYPE html>.`;

      const requestContents = {
        parts: [
          { inlineData: { data: resumeBase64, mimeType: resumeFile.type } },
          { inlineData: { data: templateBase64, mimeType: templateFile.type } },
          { text: prompt }
        ]
      };

      const pager = await ai.models.list({ config: { pageSize: 100 } });
      const availableModels = [...pager.page];
      while (pager.hasNextPage()) {
        const nextPage = await pager.nextPage();
        availableModels.push(...nextPage);
      }

      const modelCatalog = availableModels.map((m) => ({
        name: m.name || '(no-name)',
        displayName: m.displayName || '(no-display-name)',
        supportedActions: m.supportedActions || [],
      }));
      console.log('Available Gemini models:', modelCatalog);

      const matchedModel = availableModels.find((m) => {
        const supportsGenerateContent = (m.supportedActions || []).includes('generateContent');
        return supportsGenerateContent && isTargetModel(m.name, m.displayName);
      });

      if (!matchedModel?.name) {
        throw new Error(`Model "${TARGET_MODEL_DISPLAY_NAME}" is not available for this API key/project.`);
      }

      const selectedModel = TARGET_MODEL_API_IDS.find(
        (id) => normalizeModelName(matchedModel.name).toLowerCase() === id.toLowerCase(),
      ) || TARGET_MODEL_API_IDS[0];

      if (!isValidGeminiModelId(selectedModel)) {
        throw new Error(`Resolved model ID is invalid: ${selectedModel}`);
      }
      console.log('Using Gemini model:', { selectedModel, sourceName: matchedModel.name, sourceDisplayName: matchedModel.displayName });

      let response;
      let lastError: unknown = null;
      const modelFormatCandidates = getModelFormatCandidates(selectedModel);

      for (const modelFormat of modelFormatCandidates) {
        for (let attempt = 0; attempt <= MAX_QUOTA_RETRIES; attempt++) {
          try {
            const config: { temperature: number; systemInstruction?: string } = {
              temperature: 0.2,
            };
            if (supportsDeveloperInstruction(modelFormat)) {
              config.systemInstruction = SYSTEM_INSTRUCTION;
            }

            response = await ai.models.generateContent({
              model: modelFormat,
              contents: requestContents,
              config,
            });
            break;
          } catch (err) {
            lastError = err;
            const message = extractErrorMessage(err);

            if (/developer instruction is not enabled/i.test(message)) {
              response = await ai.models.generateContent({
                model: modelFormat,
                contents: requestContents,
                config: { temperature: 0.2 },
              });
              break;
            }

            const retryMs = extractRetryDelayMs(message);
            const canRetrySameModel = isQuotaExceededError(message) && retryMs !== null && attempt < MAX_QUOTA_RETRIES;

            if (canRetrySameModel) {
              await delay(retryMs + 500);
              continue;
            }

            if (/generatecontentrequest\.model|unexpected model name format/i.test(message)) {
              break;
            }

            throw err;
          }
        }

        if (response) {
          console.log('Using Gemini model format:', modelFormat);
          break;
        }
      }

      if (!response) {
        throw lastError;
      }

      let html = response.text || '';
      
      // Robust HTML extraction to handle markdown wrappers if the model still includes them
      const match = html.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
      if (match) {
        html = match[1];
      } else {
        html = html.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
      }
      
      setGeneratedHtml(html);
    } catch (err) {
      console.error('Generation error:', err);
      setError(formatGenerationError(err));
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

          {/* Right Column: Preview / Code Editor */}
          <div className="lg:col-span-8 flex flex-col h-full">
            {generatedHtml && (
              <div className="flex items-center gap-2 mb-4 print:hidden">
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'preview' 
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200' 
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Eye className="h-4 w-4" />
                  Preview
                </button>
                <button
                  onClick={() => setActiveTab('code')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'code' 
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200' 
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Code className="h-4 w-4" />
                  Edit HTML/CSS
                </button>
              </div>
            )}

            <div className="bg-gray-200/50 rounded-xl p-4 sm:p-8 flex-grow flex justify-center overflow-x-auto border border-gray-200 print:p-0 print:border-none print:bg-transparent">
              {generatedHtml ? (
                activeTab === 'preview' ? (
                  <div 
                    id="printable-resume"
                    className="bg-white shadow-2xl print:shadow-none"
                    style={{ 
                      width: '210mm', 
                      minHeight: '297mm',
                      transformOrigin: 'top center',
                    }}
                    dangerouslySetInnerHTML={{ __html: generatedHtml }}
                  />
                ) : (
                  <textarea
                    value={generatedHtml}
                    onChange={(e) => setGeneratedHtml(e.target.value)}
                    className="w-full h-full min-h-[800px] p-4 font-mono text-sm bg-gray-900 text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    spellCheck={false}
                  />
                )
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-400 h-full min-h-[800px] print:hidden">
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
