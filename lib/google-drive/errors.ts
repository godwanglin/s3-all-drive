import { errorResponse } from "@/lib/api-response";

export function driveError(error: unknown) {
  console.error("Google Drive request failed");
  return errorResponse("DRIVE_REQUEST_FAILED", "Unable to access Google Drive.", 502);
}
