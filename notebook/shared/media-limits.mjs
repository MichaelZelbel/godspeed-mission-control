// The largest media file a person can add, one number for both sides: the server's
// /api/media/upload refuses a larger file, and the note editor refuses it before sending,
// naming this same limit. Files over 50 MB stay on the computer they were added on (#507),
// so this must stay well above that.
export const MEDIA_UPLOAD_MAX_MB=100;
export const MEDIA_UPLOAD_MAX_BYTES=MEDIA_UPLOAD_MAX_MB*1024*1024;
// What a request may carry beyond the file: the form's own framing and a PDF's text read in
// the browser (at most 1,000,000 characters, so at most 3 MB as UTF-8).
export const MEDIA_UPLOAD_REQUEST_EXTRA_BYTES=4*1024*1024;
