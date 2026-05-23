import imageCompression from 'browser-image-compression';

export async function compressImage(file: File): Promise<File> {
	return imageCompression(file, {
		maxSizeMB: 0.5,
		maxWidthOrHeight: 800,
		useWebWorker: true,
		fileType: 'image/webp'
	});
}

export function isValidImageType(file: File): boolean {
	return ['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type);
}
