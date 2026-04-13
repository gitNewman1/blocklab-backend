import { config } from '../config';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

type RoboflowImageInput = {
  type: 'url';
  value: string;
};

type RoboflowResponse = unknown;

export class RoboflowService {
  async detectByImageUrl(imageUrl: string): Promise<RoboflowResponse> {
    if (!config.roboflow.apiKey) {
      throw new Error('ROBOFLOW_API_KEY is missing');
    }
    if (!config.roboflow.workflowUrl) {
      throw new Error('ROBOFLOW_WORKFLOW_URL is missing');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.roboflow.timeoutMs);

    try {
      const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

      const response = await undiciFetch(config.roboflow.workflowUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: config.roboflow.apiKey,
          inputs: {
            image: {
              type: 'url',
              value: imageUrl
            } as RoboflowImageInput
          }
        }),
        signal: controller.signal,
        dispatcher
      } as any);

      if (!response.ok) {
        const bodyPreview = (await response.text()).slice(0, 500);
        throw new Error(`Roboflow request failed: HTTP ${response.status}, body=${bodyPreview}`);
      }

      return (await response.json()) as RoboflowResponse;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Roboflow request timeout after ${config.roboflow.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
