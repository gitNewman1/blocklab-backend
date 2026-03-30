import { config } from '../config';

type RoboflowImageInput = {
  type: 'url';
  value: string;
};

type RoboflowResponse = unknown;

export class RoboflowService {
  async detectByImageUrl(imageUrl: string): Promise<RoboflowResponse> {
    if (!config.roboflow.apiKey) {
      throw new Error('API_KEY is missing');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.roboflow.timeoutMs);

    try {
      const response = await fetch(config.roboflow.workflowUrl, {
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
        signal: controller.signal
      });

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
