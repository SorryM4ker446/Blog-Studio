const { imgSize } = require('@mdit/plugin-img-size');

/**
 * Re-export the modern, browser-safe image size plugin.
 * Supports: ![alt =WxH](url)
 */
module.exports = {
  imageSizePlugin: imgSize
};
