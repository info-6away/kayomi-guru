// What Microsoft reads to confirm that koyomi.guru is the publisher of Koyomi's app registration,
// so its consent screen can name the domain (Microsoft calls this "publisher domain"). It holds
// only the app's client id, which is public: it is in every address that leads to Microsoft's
// sign-in. Where no Microsoft client is set up, there is nothing to say.
export const dynamic = 'force-dynamic';

export function GET() {
  const applicationId = process.env.MICROSOFT_CALENDAR_CLIENT_ID?.trim();
  if (!applicationId) return new Response(null, { status: 404 });
  return Response.json({ associatedApplications: [{ applicationId }] }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
