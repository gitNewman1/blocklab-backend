import { config } from '../config';

type RoboflowResponse = unknown;

export class RoboflowService {
  async detectByImageUrl(imageUrl: string): Promise<RoboflowResponse> {
    const endpoint = config.inference.serviceUrl;
    if (!endpoint) {
      // 回退到旧版 Roboflow 云端 — 需要后续迁移
      return this.detectByRoboflow(imageUrl);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.inference.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
        signal: controller.signal
      });

      if (!response.ok) {
        const bodyPreview = (await response.text()).slice(0, 500);
        throw new Error(`Inference service failed: HTTP ${response.status}, body=${bodyPreview}`);
      }

      return (await response.json()) as RoboflowResponse;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Inference service timeout after ${config.inference.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 旧版 Roboflow 云端回退方案
   * 当 INFERENCE_SERVICE_URL 未配置时使用
   */
  private async detectByRoboflow(imageUrl: string): Promise<RoboflowResponse> {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici');

    if (!config.roboflow.apiKey) {
      throw new Error('ROBOFLOW_API_KEY is missing');
    }
    if (!config.roboflow.workflowUrl) {
      throw new Error('Neither INFERENCE_SERVICE_URL nor ROBOFLOW_WORKFLOW_URL is configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.roboflow.timeoutMs);

    try {
      const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

      const response = await undiciFetch(config.roboflow.workflowUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: config.roboflow.apiKey,
          inputs: {
            image: { type: 'url', value: imageUrl }
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
