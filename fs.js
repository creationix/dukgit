"use strict";
/*globals -open,-close*/
/*
Blocking/Throwing (coroutine) FS
================================

This is the low-level fs wrapping dukluv using coroutines.
All function block by yielding the current coroutine and will throw errors into
the coroutine as exceptions.  Use try..catch if you want to handle errors.

fs.open(path, flags="r", mode=0666") -> fd - Open a file.
fs.mkdir(path)                             - Make a directory.
fs.write(fd, data, offset=-1) -> written   - Write data to file descriptor.
fs.read(fd, len, offset=-1) -> written     - Read data from file descriptor.
fs.fchmod(fd, mode)                        - Change mode of open file.
fs.fstat(fd) -> stat                       - Read stat of open file.
fs.rename(from, to)                        - Rename file path.
fs.unlink(path)                            - Delete a file by path.
fs.rmdir(path)                             - Remove a directory by path.
fs.scandir(path) -> iter                   - Iterate a directory.
fs.close(fd)                               - Close a file descriptor.

*/

return function (root) {

  var wait = Duktape.Thread.yield;
  var resume = Duktape.Thread.resume;
  var current = Duktape.Thread.current;

  return {
    open: open,
    mkdir: mkdir,
    write: write,
    read: read,
    fchmod: fchmod,
    fstat: fstat,
    rename: rename,
    unlink: unlink,
    rmdir: rmdir,
    scandir: scandir,
    close: close,
  };

  // Joins path segments.  Preserves initial "/" and resolves ".." and "."
  // Does not support using ".." to go above/outside the root.
  // This means that join("foo", "../../bar") will not resolve to "../bar"
  function join(/* path segments */) {
    // Split the inputs into a list of path commands.
    var parts = [];
    for (var i = 0, l = arguments.length; i < l; i++) {
      parts = parts.concat(arguments[i].split("/"));
    }
    // Interpret the path commands to get the new resolved path.
    var newParts = [];
    for (i = 0, l = parts.length; i < l; i++) {
      var part = parts[i];
      // Remove leading and trailing slashes
      // Also remove "." segments
      if (!part || part === ".") { continue; }
      // Interpret ".." to pop the last segment
      if (part === "..") { newParts.pop(); }
      // Push new path segments.
      else { newParts.push(part); }
    }
    // Preserve the initial slash if there was one.
    if (parts[0] === "") {newParts.unshift(""); }
    // Turn back into a single string path.
    return newParts.join("/") || (newParts.length ? "/" : ".");
  }

  function resolve(path) {
    if (!root) { return path; }
    return join(root, path);
  }

  function makeCallback() {
    var thread = current();
    return function (value, err) {
      if (err) { return resume(thread, err, true); }
      return resume(thread, value);
    };
  }

  function open(path, flags, mode) {
    uv.fs_open(resolve(path), flags || "r", mode || 438, makeCallback());
    return wait();
  }

  function mkdir(path, mode) {
    uv.fs_mkdir(resolve(path), mode || 511, makeCallback());
    return wait();
  }

  function write(fd, data, offset) {
    uv.fs_write(fd, data, offset || -1, makeCallback());
    return wait();
  }

  function read(fd, len, offset) {
    uv.fs_read(fd, len || 8096, offset || -1, makeCallback());
    return wait();
  }

  function fchmod(fd, mode) {
    uv.fs_fchmod(fd, mode, makeCallback());
    return wait();
  }

  function fstat(fd) {
    uv.fs_fstat(fd, makeCallback());
    return wait();
  }

  function rename(path, newPath) {
    uv.fs_rename(resolve(path), resolve(newPath), makeCallback());
    return wait();
  }

  function unlink(path) {
    uv.fs_unlink(resolve(path), makeCallback());
    return wait();
  }

  function rmdir(path) {
    uv.fs_rmdir(resolve(path), makeCallback());
    return wait();
  }

  function scandir(path) {
    uv.fs_scandir(resolve(path), makeCallback());
    var req = wait();
    return function () {
      return uv.fs_scandir_next(req);
    };
  }

  function close(fd) {
    uv.fs_close(fd, makeCallback());
    return wait();
  }
};
