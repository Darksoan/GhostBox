/**
 * Reamostragem e codificação das imagens de perfil antes de subir pra nuvem.
 *
 * Dois objetivos que puxam em direções opostas: a capa precisa aguentar uma
 * janela maximizada em monitor grande (senão o `object-fit: cover` estica uma
 * fonte pequena e borra), e o bucket não pode encher de arquivo gigante.
 *
 * A saída é WebP — o bucket `profile-images` aceita jpeg/png/webp, e WebP entrega
 * a mesma qualidade percebida de um JPEG em torno de 30% menos bytes. É essa
 * economia que paga o aumento de resolução: mais pixels e ainda assim arquivos
 * menores do que o JPEG q1.0 que era gerado antes.
 */

/** Teto de pixels da capa: 2560×1440. Cobre monitor 1440p em tela cheia e
 *  sobra margem pro upscale de um 4K, sem virar arquivo de vários MB. */
export const bannerMaxPixels = 2560 * 1440;

/** Freio de lado longo pra fonte ultrawide/panorâmica: mesmo dentro do
 *  orçamento de pixels, nada passa de 3840 num eixo. */
export const bannerMaxDimension = 3840;

/** Alvo de tamanho do arquivo final da capa. Passou disso, a qualidade desce um
 *  degrau e recodifica. */
export const bannerTargetBytes = 1_100_000;

/** Piso: abaixo disso a imagem começa a mostrar bloco em áreas de céu/gradiente. */
export const bannerQualitySteps = [0.86, 0.78, 0.7, 0.62] as const;

export const avatarSize = 512;
export const avatarQuality = 0.85;

export interface FittedSize {
  width: number;
  height: number;
  scale: number;
}

/**
 * Maior tamanho que respeita ao mesmo tempo o orçamento de pixels e o teto de
 * lado. Nunca amplia: `scale` fica em 1 quando a fonte já cabe.
 */
export function fitWithinBudget(
  width: number,
  height: number,
  maxPixels = bannerMaxPixels,
  maxDimension = bannerMaxDimension
): FittedSize {
  if (!width || !height || width < 0 || height < 0) {
    return { width: 0, height: 0, scale: 1 };
  }

  const pixelScale = Math.sqrt(maxPixels / (width * height));
  const dimensionScale = Math.min(
    maxDimension / width,
    maxDimension / height
  );
  const scale = Math.min(1, pixelScale, dimensionScale);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Bytes reais por trás de um data URL base64 (descontando padding e cabeçalho). */
export function dataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return 0;

  const payload = dataUrl.slice(commaIndex + 1);
  if (!dataUrl.slice(0, commaIndex).includes(";base64")) {
    return payload.length;
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function dataUrlMimeType(dataUrl: string): string {
  const match = /^data:([^;,]+)/.exec(dataUrl);
  return match?.[1]?.toLowerCase() ?? "";
}

/**
 * Recodificar sempre custa uma geração de perda. Quando a fonte já é WebP,
 * já cabe no orçamento de pixels e já é pequena em bytes, o melhor arquivo
 * possível é o que já está na mão.
 */
export function canPassThrough(dataUrl: string, fitted: FittedSize): boolean {
  return (
    fitted.scale >= 1 &&
    dataUrlMimeType(dataUrl) === "image/webp" &&
    dataUrlByteLength(dataUrl) <= bannerTargetBytes
  );
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Profile image could not be loaded"));
    image.src = source;
  });
}

/**
 * `toDataURL` com um tipo não suportado não avisa: devolve PNG silenciosamente
 * — e um PNG de foto é ordens de grandeza maior que o WebP esperado. Confere o
 * cabeçalho do resultado em vez de confiar no pedido.
 */
function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality: number
): { dataUrl: string; mime: string } {
  const webp = canvas.toDataURL("image/webp", quality);
  if (dataUrlMimeType(webp) === "image/webp") {
    return { dataUrl: webp, mime: "image/webp" };
  }

  const jpeg = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl: jpeg, mime: dataUrlMimeType(jpeg) };
}

function drawToCanvas(
  image: CanvasImageSource,
  width: number,
  height: number
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

/**
 * Redimensiona a capa pro orçamento e codifica descendo a qualidade até caber
 * no alvo de bytes. Resolução vem antes de qualidade de propósito: numa capa
 * esticada em tela cheia, pixel faltando aparece muito mais que artefato de
 * compressão.
 */
export async function encodeBannerDataUrl(source: string): Promise<string> {
  const image = await loadImage(source);
  const fitted = fitWithinBudget(image.naturalWidth, image.naturalHeight);
  if (!fitted.width || !fitted.height) return source;
  if (canPassThrough(source, fitted)) return source;

  const canvas = drawToCanvas(image, fitted.width, fitted.height);
  if (!canvas) return source;

  let encoded = encodeCanvas(canvas, bannerQualitySteps[0]);
  for (const quality of bannerQualitySteps.slice(1)) {
    if (dataUrlByteLength(encoded.dataUrl) <= bannerTargetBytes) break;
    encoded = encodeCanvas(canvas, quality);
  }

  // Última linha: fonte enorme em que nem a qualidade mínima cabe. Corta a
  // resolução pela metade da área e recodifica no topo da escala — é melhor uma
  // capa 1810px nítida do que uma 2560px cheia de bloco.
  if (dataUrlByteLength(encoded.dataUrl) > bannerTargetBytes) {
    const halved = fitWithinBudget(
      fitted.width,
      fitted.height,
      bannerMaxPixels / 2
    );
    const smallerCanvas = drawToCanvas(image, halved.width, halved.height);
    if (smallerCanvas) encoded = encodeCanvas(smallerCanvas, bannerQualitySteps[1]);
  }

  return encoded.dataUrl;
}

export interface AvatarCropPosition {
  x: number;
  y: number;
  scale: number;
}

/** Recorte quadrado do avatar em `avatarSize`. 512 cobre com folga o maior
 *  destino (120 CSS px na página de perfil) mesmo em tela 2x/3x. */
export async function encodeAvatarDataUrl(
  source: string,
  position: AvatarCropPosition
): Promise<string> {
  const image = await loadImage(source);
  const sourceSize =
    Math.min(image.naturalWidth, image.naturalHeight) / position.scale;
  if (!sourceSize) return source;

  const canvas = document.createElement("canvas");
  canvas.width = avatarSize;
  canvas.height = avatarSize;

  const context = canvas.getContext("2d");
  if (!context) return source;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    ((image.naturalWidth - sourceSize) * position.x) / 100,
    ((image.naturalHeight - sourceSize) * position.y) / 100,
    sourceSize,
    sourceSize,
    0,
    0,
    avatarSize,
    avatarSize
  );

  return encodeCanvas(canvas, avatarQuality).dataUrl;
}
