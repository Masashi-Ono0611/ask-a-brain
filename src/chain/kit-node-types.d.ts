/** Kit 8.4 declarations reference Web API globals absent with lib: ES2023 and
 * @types/node 24.0. Node's actual webcrypto types are authoritative here.
 * Local compatibility adapter pending T0 review; no DOM lib or runtime shim.
 */
type CryptoKey = import('node:crypto').webcrypto.CryptoKey;
type CryptoKeyPair = import('node:crypto').webcrypto.CryptoKeyPair;
interface EventListenerOptions { capture?: boolean }
interface AddEventListenerOptions extends EventListenerOptions { once?: boolean; passive?: boolean; signal?: AbortSignal }
