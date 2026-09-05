const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { imagesToIco } = require('png-to-ico');

const ROOT = 'C:\\Users\\schro\\Downloads\\UCHIHA-Labs\\uchiha Launcher';
const LOGO = path.join(ROOT, 'images', 'main', 'r_l_logo_1.webp');
const BANNER_OUT = path.join(ROOT, 'launcher-build', 'installer-banner.png');
const ICON_OUT = path.join(ROOT, 'launcher-build', 'installer-icon.ico');

async function main() {
    await fs.promises.mkdir(path.join(ROOT, 'launcher-build'), { recursive: true });

    const logoBuf = fs.readFileSync(LOGO);
    const logoMeta = await sharp(logoBuf).metadata();
    const logoWidth = logoMeta.width || 500;
    const logoHeight = logoMeta.height || 500;

    const bannerWidth = 150;
    const bannerHeight = 300;
    const maxLogoWidth = bannerWidth - 20;
    const maxLogoHeight = bannerHeight - 120;
    const logoAspect = logoWidth / logoHeight;
    let targetWidth = maxLogoWidth;
    let targetHeight = targetWidth / logoAspect;
    if (targetHeight > maxLogoHeight) {
        targetHeight = maxLogoHeight;
        targetWidth = targetHeight * logoAspect;
    }
    targetWidth = Math.round(targetWidth);
    targetHeight = Math.round(targetHeight);

    const resizedLogo = await sharp(logoBuf)
        .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

    const bannerSvg = `
    <svg width="${bannerWidth}" height="${bannerHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0e0e14"/>
          <stop offset="100%" stop-color="#07070a"/>
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <rect width="${bannerWidth}" height="${bannerHeight}" fill="url(#bg)" rx="0" ry="0"/>
      <rect x="0" y="0" width="${bannerWidth}" height="4" fill="#e6334a"/>
      <image href="data:image/png;base64,${resizedLogo.toString('base64')}" x="${Math.round((bannerWidth - targetWidth) / 2)}" y="40" width="${targetWidth}" height="${targetHeight}"/>
      <text x="${bannerWidth / 2}" y="240" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="bold" fill="#f5f5fa" text-anchor="middle">UCHIHA</text>
      <text x="${bannerWidth / 2}" y="262" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#e6334a" text-anchor="middle">LABS</text>
      <text x="${bannerWidth / 2}" y="285" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#888" text-anchor="middle">Installer</text>
    </svg>`;

    await sharp(Buffer.from(bannerSvg))
        .png()
        .toFile(BANNER_OUT);

    const iconPngPath = path.join(ROOT, 'launcher-build', 'installer-icon-temp.png');
    await sharp(logoBuf)
        .resize(64, 64, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toFile(iconPngPath);

    const iconBuffer = await imagesToIco([iconPngPath]);
    fs.writeFileSync(ICON_OUT, iconBuffer);
    try { fs.unlinkSync(iconPngPath); } catch (e) {}

    console.log('Banner:', BANNER_OUT);
    console.log('Icon:', ICON_OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
