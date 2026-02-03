const Client = require('ssh2-sftp-client');
const sftp = new Client();
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { promisify } = require('util');
const mkdir = promisify(fs.mkdir);

const config = {
  host: process.env.SFTP_HOST,
  port: process.env.SFTP_PORT,
  username: process.env.SFTP_USER,
  password: process.env.SFTP_PASSWD
};

const DOWNLOAD_DIR = path.join(__dirname, '../downloads');

async function downloadRecordings(files, socket = null) {
  console.log(socket.id)
  // return
  try {
    // Ensure download directory exists
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      await mkdir(DOWNLOAD_DIR, { recursive: true });
    }

    await sftp.connect(config);

    if (files.length === 1) {
      // Single file download
      const file = files[0];
      const remotePath = `/var/lib/asterisk/static-http/monitor/${file}`;
      const localPath = path.join(DOWNLOAD_DIR, path.basename(file));

      await sftp.get(remotePath, localPath);

      if (socket) {
        socket.emit('downloadComplete', {
          file: path.basename(file),
          path: localPath
        });
      }
      return localPath;
    } else {
      // Multiple files - create ZIP
      const zipPath = path.join(DOWNLOAD_DIR, `recordings_${Date.now()}.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.pipe(output);

      for (const file of files) {
        const remotePath = `/var/lib/asterisk/static-http/monitor/${file}`;
        const fileData = await sftp.get(remotePath);
        archive.append(fileData, { name: path.basename(file) });
      }

      await archive.finalize();

      if (socket) {
        socket.emit('downloadComplete', {
          file: path.basename(zipPath),
          path: zipPath
        });
      }
      return zipPath;
    }
  } catch (error) {
    console.error('Download error:', error);
    if (socket) {
      socket.emit('downloadError', error.message);
    }
    throw error;
  } finally {
    if (sftp.client) {
      await sftp.end();
    }
  }
}

module.exports = { downloadRecordings };