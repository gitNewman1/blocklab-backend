declare module 'esdk-obs-nodejs' {
  export default class ObsClient {
    constructor(config: {
      access_key_id: string;
      secret_access_key: string;
      server: string;
    });
    putObject(params: {
      Bucket: string;
      Key: string;
      Body: Buffer;
    }): Promise<any>;
  }
}
