export function drawFrameToCanvas(canvas, image) {
  const context = canvas?.getContext?.('2d');
  if (!canvas || !context || !image) return false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return true;
}
