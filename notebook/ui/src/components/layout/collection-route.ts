export const isCollectionPage = (pathname: string) =>
  /^\/collections\/(?!templates(\/|$))[^/]+\/?$/.test(pathname);

// An open collection item: /collections/<slug>/<item> (the schema page is not one).
export const isCollectionItemPage = (pathname: string) =>
  /^\/collections\/(?!templates(\/|$))[^/]+\/(?!schema\/?$)[^/]+\/?$/.test(pathname);
