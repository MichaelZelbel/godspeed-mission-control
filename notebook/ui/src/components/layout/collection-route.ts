export const isCollectionPage = (pathname: string) =>
  /^\/collections\/(?!templates(\/|$))[^/]+\/?$/.test(pathname);
