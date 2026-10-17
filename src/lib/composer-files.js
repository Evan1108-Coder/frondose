const MAX_FILE_SIZE = 350_000;
const MAX_TOTAL_SIZE = 650_000;

export function containsDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

export async function readComposerFiles(fileList, existing = []) {
  const files = Array.from(fileList || []);
  if (!files.length) return existing;
  const next = await Promise.all(files.map(async file => {
    if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} is too large. Choose a file under 350 KB.`);
    let content;
    if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) content = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsDataURL(file);
    });
    else if (file.type.startsWith('text/') || /\.(txt|md|json|js|jsx|ts|tsx|css|html|csv|py|rs|go|yaml|yml|xml|sql|sh)$/i.test(file.name)) content = await file.text();
    else throw new Error('Choose a text file, code file, or PNG, JPEG, WebP, or GIF image.');
    return { name: file.name, type: file.type || 'text/plain', size: file.size, content };
  }));
  const combined = [...existing, ...next];
  if (combined.length > 20) throw new Error('Attach up to 20 files at a time.');
  if (new TextEncoder().encode(JSON.stringify(combined)).length > MAX_TOTAL_SIZE) throw new Error('These attachments are too large together. Send them separately.');
  return combined;
}
