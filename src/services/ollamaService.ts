export interface OllamaGenerateParams {
  prompt: string;
  images?: string[]; // Array of base64 encoded images
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  format?: 'json' | object; // 'json' or JSON schema
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class OllamaService {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || 'qwen2.5vl:7b';
  }

  get isConfigured(): boolean {
    return process.env.VITE_OFFLINE_MODE === 'true';
  }

  async generate(params: OllamaGenerateParams): Promise<{ text: string; modelUsed: string; finishReason?: string } | null> {
    if (!this.isConfigured) return null;

    const timeoutMs = params.timeoutMs || 120000; // Local models can be slow
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    // If external signal is aborted, abort our fetch too
    if (params.signal) {
      params.signal.addEventListener('abort', () => {
        controller.abort();
      });
      if (params.signal.aborted) {
        clearTimeout(timeoutHandle);
        return null;
      }
    }

    try {
      let finalPrompt = params.prompt;
      if (params.systemInstruction) {
        finalPrompt = `<system>\n${params.systemInstruction}\n</system>\n\n<user>\n${params.prompt}\n</user>`;
      }

      const requestBody: any = {
        model: this.model,
        prompt: finalPrompt,
        stream: false,
        options: {
          temperature: params.temperature ?? 0.1,
          num_predict: params.maxOutputTokens ?? 4096,
        },
      };

      if (params.images && params.images.length > 0) {
        requestBody.images = params.images;
      }

      if (params.format === 'json') {
        requestBody.format = 'json';
      }

      console.log(`[Ollama] Generating with ${this.model}...`);

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        text: data.response,
        modelUsed: this.model,
        finishReason: data.done_reason || 'stop',
      };
    } catch (error: any) {
      clearTimeout(timeoutHandle);
      if (error.name === 'AbortError') {
        console.warn(`[Ollama] Generation aborted (timeout or client disconnected)`);
      } else {
        console.error(`[Ollama] Error calling model ${this.model}:`, error.message);
      }
      return null;
    }
  }

  async checkStatus(): Promise<{ status: 'ok' | 'error', model: string, error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (res.ok) {
        return { status: 'ok', model: this.model };
      }
      return { status: 'error', model: this.model, error: `HTTP ${res.status}` };
    } catch (e: any) {
      return { status: 'error', model: this.model, error: e.message };
    }
  }
}

export const ollamaService = new OllamaService();
