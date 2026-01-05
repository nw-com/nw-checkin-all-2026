const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 8080;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  console.log(`Request: ${req.url}`);

  // Handle URL parameters (ignore them for file serving)
  const urlPath = req.url.split('?')[0];
  
  let filePath = '.' + urlPath;
  if (filePath === './') {
    filePath = './index.html';
  }

  // Prevent directory traversal
  const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const absolutePath = path.resolve(__dirname, safePath);

  // Check if file exists
  fs.access(absolutePath, fs.constants.F_OK, (err) => {
      if (err) {
          console.log(`File not found: ${absolutePath}`);
          res.writeHead(404);
          res.end('404 File Not Found');
          return;
      }

      // If it is a directory, try serving index.html
      if (fs.statSync(absolutePath).isDirectory()) {
          const indexPath = path.join(absolutePath, 'index.html');
          if (fs.existsSync(indexPath)) {
              filePath = indexPath; // This logic is a bit circular with the first check, but handles subdirectories
          } else {
             // Just list directory or 403? 
             // For now let's stick to the file reading logic below which uses filePath
          }
      }
      
      const extname = String(path.extname(absolutePath)).toLowerCase();
      const contentType = mimeTypes[extname] || 'application/octet-stream';

      fs.readFile(absolutePath, (error, content) => {
        if (error) {
          if(error.code == 'ENOENT'){
            res.writeHead(404);
            res.end('404 File Not Found');
          } else {
            res.writeHead(500);
            res.end('Sorry, check with the site admin for error: '+error.code+' ..\n');
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content, 'utf-8');
        }
      });
  });

}).listen(port);

console.log(`Server running at http://localhost:${port}/`);
