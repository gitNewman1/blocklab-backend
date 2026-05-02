import * as crypto from 'crypto';
import { config } from '../config';

const HOST = 'ai3d.tencentcloudapi.com';
const SERVICE = 'ai3d';
const VERSION = '2025-05-13';

function sign(secretKey: string, date: string, service: string, stringToSign: string): string {
  const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const kService = crypto.createHmac('sha256', kDate).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
  return crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
}

async function callApi(action: string, payload: object): Promise<any> {
  const { secretId, secretKey, region } = config.hunyuan3d;
  if (!secretId || !secretKey) throw new Error('HUNYUAN3D credentials missing');

  const body = JSON.stringify(payload);
  const now = Math.floor(Date.now() / 1000);
  const date = new Date(now * 1000).toISOString().slice(0, 10);

  const hashedPayload = crypto.createHash('sha256').update(body).digest('hex');
  const contentType = 'application/json; charset=utf-8';
  const canonicalRequest = `POST\n/\n\ncontent-type:${contentType}\nhost:${HOST}\nx-tc-action:${action.toLowerCase()}\n\ncontent-type;host;x-tc-action\n${hashedPayload}`;
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = `TC3-HMAC-SHA256\n${now}\n${credentialScope}\n${hashedCanonicalRequest}`;
  const signature = sign(secretKey, date, SERVICE, stringToSign);
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;

  console.log('[hunyuan3d] === sign debug ===');
  console.log('[hunyuan3d] body:', body);
  console.log('[hunyuan3d] timestamp:', now, 'date:', date);
  console.log('[hunyuan3d] hashedPayload:', hashedPayload);
  console.log('[hunyuan3d] canonicalRequest:\n' + canonicalRequest);
  console.log('[hunyuan3d] hashedCanonicalRequest:', hashedCanonicalRequest);
  console.log('[hunyuan3d] stringToSign:\n' + stringToSign);
  console.log('[hunyuan3d] signature:', signature);
  console.log('[hunyuan3d] authorization:', authorization);

  const res = await fetch(`https://${HOST}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Host': HOST,
      'X-TC-Action': action,
      'X-TC-Version': VERSION,
      'X-TC-Region': region,
      'X-TC-Timestamp': String(now),
      'Authorization': authorization
    },
    body
  });

  const json = await res.json() as any;
  console.log(`[hunyuan3d] ${action} response:`, JSON.stringify(json));
  if (json.Response?.Error) throw new Error(`${json.Response.Error.Code}: ${json.Response.Error.Message}`);
  return json.Response;
}

export class Hunyuan3dService {
  async submitJob(imageUrl: string): Promise<string> {
    const resp = await callApi('SubmitHunyuanTo3DProJob', { ImageUrl: imageUrl });
    return resp.JobId as string;
  }

  async queryJob(jobId: string): Promise<{ status: string; modelUrl?: string }> {
    const resp = await callApi('QueryHunyuanTo3DProJob', { JobId: jobId });
    const status: string = resp.Status;
    const modelUrl = status === 'DONE'
      ? (resp.ResultFile3Ds as any[])?.find(f => f.Type === 'GLB')?.Url
        ?? (resp.ResultFile3Ds as any[])?.[0]?.Url
      : undefined;
    return { status, modelUrl };
  }
}
