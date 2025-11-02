declare module "undici" {
  export interface Dispatcher {}

  export class ProxyAgent implements Dispatcher {
    constructor(proxy: string | URL, opts?: unknown);
  }
}
