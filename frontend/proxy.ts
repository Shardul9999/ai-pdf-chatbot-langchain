import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from 'next/server';
const isProtectedPage = createRouteMatcher(['/']);
const clerk = clerkMiddleware(async (auth, req) => {
  // APIs authenticate in each handler so clients receive JSON 401 responses.
  if (isProtectedPage(req)) await auth.protect();
});
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (req.nextUrl.pathname === '/api/health') return NextResponse.next();
  return clerk(req, event);
}
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)',
    '/api/(.*)',
  ],
};
