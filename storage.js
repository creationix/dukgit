"use strict";

/*
Low Level Storage Commands
==========================

These are the filesystem abstractions needed by a git database

storage.write(path, raw)     - Write mutable data by path
storage.put(path, raw)       - Write immutable data by path
storage.read(path) -> raw    - Read data by path (nil if not found)
storage.remove(path)         - Delete an entry (removes empty parent directories)
storage.nodes(path) -> iter  - Iterate over node children of path
                               (empty iter if not found)
storage.leaves(path) -> iter - Iterate over node children of path
                               (empty iter if not found)
*/

return function (fs) {

  return {
    fs: fs,
    write: write,
    put: put,
    read: read,
    remove: remove,
    nodes: nodes,
    leaves: leaves,
  };

  function mkdirp(path) {
    try {
      fs.mkdir(path);
    }
    catch (err) {
      // If it already exists, we're done!
      if (/^EEXIST:/.test(err.message)) { return; }
      // If it's some other error, re-throw it.
      if (!/^ENOENT:/.test(err.message)) { throw err; }
      // Try the parent first and then try one last time.
      mkdirp(dirname(path));
      fs.mkdir(path);
    }
  }

  function dirname(path) {
    var match = path.match(/^(.*)\//);
    return match ? match[1] : "";
  }

  // Perform an atomic write (with temp file and rename) for mutable data
  function write(path, data) {
    var tempPath = path + "~";
    // Ensure the parent directory exists first.
    mkdirp(dirname(path));
    // Write the data to disk using try..finally to ensure the fd doesn't leak
    // in case of errors.
    var fd = fs.open(tempPath, "w", 384);
    try { fs.write(fd, data); }
    finally { fs.close(fd); }
    // Rename the temp file on top of the old file for atomic commit.
    fs.rename(tempPath, path);
  }

  // Write immutable data with an exclusive open.
  function put(path, data) {
    // Ensure the parent directory exists first.
    mkdirp(dirname(path));
    // Try to open the file in exclusive write mode.
    var fd;
    try { fd = fs.open(path, "wx"); }
    catch (err) {
      // If the file already exists, bail out, it's immutable.
      if (/^EEXIST:/.test(err.message)) { return; }
      throw err;
    }
    // Write the data and ensure the fd gets closed using finally.
    try { fs.write(fd, data); }
    finally { fs.close(fd); }
  }

  function read(path) {
    var fd;
    try { fd = fs.open(path, "r"); }
    catch (err) {
      // Return nothing for ENOENT errors, re-throw all others.
      if (/^ENOENT:/.test(err.message)) { return; }
      throw err;
    }
    try {
      var stat = fs.fstat(fd);
      return fs.read(fd, stat.size);
    }
    finally {
      fs.close(fd);
    }
  }

  function remove(path) {
    fs.unlink(path);
    var dirPath = path;
    while ((dirPath = dirname(dirPath))) {
      var iter = fs.scandir(dirPath);
      if (iter()) { return; }
      fs.rmdir(dirPath);
    }
  }

  function iter(path, filter) {
    var it;
    try {
      it = fs.scandir(path);
    }
    catch (err) {
      if (/^ENOENT:/.test(err.message)) { return; }
      throw err;
    }
    return function () {
      var item;
      while ((item = it())) {
        if (item.type === filter) {
          return item.name;
        }
      }
    };
  }

  function nodes(path) {
    return iter(path, "directory");
  }

  function leaves(path) {
    return iter(path, "file");
  }
};
