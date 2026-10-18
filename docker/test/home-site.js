// For docker/test.sh only: a site with a login, served inside the container that plays the
// user's computer. /login sets the login cookie, /account shows whether the browser sent it.
require('http').createServer((req, res) => {
  if (req.url === '/login') {
    res.writeHead(200, { 'set-cookie': 'gs_login=yes; Max-Age=3600; Path=/', 'content-type': 'text/html' });
    return res.end('<title>Log in</title><p>You are logged in.</p>');
  }
  if (req.url === '/account') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<title>Your account</title><p>Account page. Cookie: ' + (req.headers.cookie || 'none') + '</p>');
  }
  res.writeHead(404); res.end();
}).listen(8099, '127.0.0.1');
