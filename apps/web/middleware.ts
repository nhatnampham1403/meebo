import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'meebo_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function middleware(request: NextRequest) {
  const secret = process.env.APP_SECRET;

  // If APP_SECRET is not configured, allow all traffic (local dev mode)
  if (!secret) {
    return NextResponse.next();
  }

  const key = request.nextUrl.searchParams.get('key');
  if (key === secret) {
    const url = request.nextUrl.clone();
    url.searchParams.delete('key');
    const response = NextResponse.redirect(url);
    response.cookies.set(COOKIE_NAME, secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
    });
    return response;
  }

  const cookie = request.cookies.get(COOKIE_NAME);
  if (cookie?.value === secret) {
    return NextResponse.next();
  }

  return new NextResponse('Unauthorized', { status: 401 });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
