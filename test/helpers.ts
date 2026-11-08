import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RequestRecord {
  readonly method: string;
  readonly url: URL;
  readonly headers: IncomingMessage["headers"];
  readonly body: unknown;
}

export const product = {
  productId: "42", productName: "Frozen lunch", items: [{ itemId: "84", sellers: [{ sellerId: "1", commertialOffer: { Price: 19.9, AvailableQuantity: 8 } }] }],
};
export const cart = { orderFormId: "cart-1", items: [], value: 0, totalizers: [], shippingData: null };

export function json(response: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

export async function serverTest<T>(
  handler: (request: RequestRecord, response: ServerResponse, index: number) => void | Promise<void>,
  run: (context: { origin: string; requests: RequestRecord[] }) => Promise<T>,
): Promise<T> {
  const requests: RequestRecord[] = [];
  const server = createServer(async (req, res) => {
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    const raw = Buffer.concat(buffers).toString();
    const request = { method: req.method!, url: new URL(req.url!, "http://local.test"), headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    requests.push(request);
    await handler(request, res, requests.length - 1);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { return await run({ origin, requests }); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
