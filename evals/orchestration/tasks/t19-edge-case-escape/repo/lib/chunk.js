function chunkArray(items, size) {
  const result = [];
  // BUG: floors the chunk count, so a remainder shorter than `size` is
  // silently dropped instead of appearing as its own trailing chunk.
  const fullChunks = Math.floor(items.length / size);
  for (let i = 0; i < fullChunks; i++) {
    result.push(items.slice(i * size, i * size + size));
  }
  return result;
}

module.exports = { chunkArray };
