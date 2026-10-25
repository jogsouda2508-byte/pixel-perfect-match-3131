import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Bridges to the Android app (Capacitor). Android's built-in web view has no share sheet, no
 * file download and an unreliable clipboard, so inside the app these use the real Android
 * features. They are only used when the matching Capacitor plugin is installed in the APK
 * (npm i @capacitor/share @capacitor/filesystem @capacitor/clipboard, then `npx cap sync android`
 * and rebuild). In a normal browser, or an old APK without them, every function says "not
 * available" and the caller uses its web fallback.
 *
 * registerPlugin comes from @capacitor/core (already installed), so the web build needs no new package.
 */
type SharePlugin = {
  share(opts: {
    title?: string;
    text?: string;
    url?: string;
    files?: string[];
    dialogTitle?: string;
  }): Promise<unknown>;
};
type FilesystemPlugin = {
  writeFile(opts: {
    path: string;
    data: string;
    directory?: string;
    recursive?: boolean;
  }): Promise<{ uri: string }>;
  requestPermissions?(): Promise<unknown>;
};
type MediaPlugin = {
  createAlbum(opts: { name: string }): Promise<void>;
  getAlbums(): Promise<{ albums: { identifier: string; name: string }[] }>;
  savePhoto(opts: {
    path: string;
    albumIdentifier?: string;
    fileName?: string;
  }): Promise<unknown>;
};
type ClipboardPlugin = { write(opts: { string: string }): Promise<void> };

const Share = registerPlugin<SharePlugin>("Share");
const Filesystem = registerPlugin<FilesystemPlugin>("Filesystem");
const Media = registerPlugin<MediaPlugin>("Media");
const Clipboard = registerPlugin<ClipboardPlugin>("Clipboard");

const has = (name: string) =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(name);

/** Opens Android's share sheet. Returns false if it isn't available (use the web fallback). */
export async function nativeShareLink(opts: {
  title: string;
  text: string;
  url: string;
}): Promise<boolean> {
  if (!has("Share")) return false;
  try {
    await Share.share({ ...opts, dialogTitle: "Share profile" });
  } catch {
    /* closed without sharing: nothing to do */
  }
  return true;
}

/** Copies with Android's clipboard. Returns true when it worked. */
export async function nativeCopy(text: string): Promise<boolean> {
  if (!has("Clipboard")) return false;
  try {
    await Clipboard.write({ string: text });
    return true;
  } catch {
    return false;
  }
}

/** True inside the Android app (Capacitor), where the web "download" doesn't work. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/**
 * Saves the QR picture on the phone: first into the Gallery (album "Gicco chat"), then the
 * Documents folder, and only if Android refuses both, the share sheet.
 * Returns "gallery", "saved", "shared", or false when the plugins aren't in the app.
 */
export async function nativeSaveImage(
  blob: Blob,
  fileName: string,
): Promise<"gallery" | "saved" | "shared" | false> {
  const ALBUM = "Gicco chat";
  // 1) Best: save into the phone's Gallery (works on every Android, no permission prompt).
  if (has("Media")) {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read"));
        r.readAsDataURL(blob);
      });
      try {
        await Media.createAlbum({ name: ALBUM });
      } catch {
        /* the album already exists */
      }
      const { albums } = await Media.getAlbums();
      const album = albums.find((a) => a.name === ALBUM);
      if (album) {
        await Media.savePhoto({
          path: dataUrl,
          albumIdentifier: album.identifier,
          fileName: fileName.replace(/\.png$/i, ""),
        });
        return "gallery";
      }
    } catch {
      /* fall through to the next way */
    }
  }
  if (!has("Filesystem")) return false;
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(blob);
  });
  try {
    await Filesystem.requestPermissions?.();
  } catch {
    /* older / newer Android may not need it */
  }
  try {
    await Filesystem.writeFile({ path: fileName, data, directory: "DOCUMENTS" });
    return "saved";
  } catch {
    /* fall through to the share sheet */
  }
  if (!has("Share")) return false;
  const { uri } = await Filesystem.writeFile({ path: fileName, data, directory: "CACHE" });
  try {
    await Share.share({ files: [uri], dialogTitle: "Save or send QR code" });
  } catch {
    /* closed without sharing */
  }
  return "shared";
}
