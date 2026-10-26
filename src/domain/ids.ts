// Идентификаторы записей: префикс + base36 времени + 4 случайных символа (`ord_lx3k9a2f`).
// Время монотонно: при нескольких вызовах в одну миллисекунду метка сдвигается на 1 мс вперёд,
// поэтому id в пределах вкладки не повторяются даже при массовом импорте.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
let lastTime = 0;

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % 36];
  return out;
}

export function newId(prefix: string): string {
  const now = Date.now();
  lastTime = now > lastTime ? now : lastTime + 1;
  return `${prefix}_${lastTime.toString(36)}${randomChars(4)}`;
}
