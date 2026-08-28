import { google } from "googleapis";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getGoogleAuthorizationUrl(state: string) {
  return createGoogleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [DRIVE_SCOPE, "openid", "email", "profile"],
    state,
  });
}
