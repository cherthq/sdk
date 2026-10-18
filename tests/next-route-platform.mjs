// Use installed Next.js request/response classes without importing unrelated server barrels.
export { NextRequest } from '../../control-plane/node_modules/next/dist/server/web/spec-extension/request.js';
export { NextResponse } from '../../control-plane/node_modules/next/dist/server/web/spec-extension/response.js';
