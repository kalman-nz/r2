import { useEffect, useRef, useState } from "react";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new () => BarcodeDetectorLike;

// Reads codes from the camera. Uses the browser's own BarcodeDetector where
// there is one (Chrome on Android) and otherwise loads the ZXing decoder
// (iPhone/iPad Safari, Firefox) — only then, so nobody else downloads it.
export default function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let stopped = false;
    let stop = () => {};
    // The same code stays in view for a while; only act on it once.
    let last = { code: "", at: 0 };
    const seen = (code: string) => {
      if (code === last.code && Date.now() - last.at < 2500) return;
      last = { code, at: Date.now() };
      onCodeRef.current(code);
    };

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setProblem("The camera only works when R2 is opened over https://. Use a Bluetooth scanner, or type the code.");
      return;
    }
    const failed = (err: unknown) => {
      if (!stopped) setProblem(`Couldn't open the camera: ${err instanceof Error ? err.message : String(err)}`);
    };

    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (Detector) {
      const detector = new Detector();
      let timer: number | undefined;
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          stop = () => {
            if (timer) window.clearTimeout(timer);
            stream.getTracks().forEach((t) => t.stop());
          };
          if (stopped) return stop();
          const video = videoRef.current;
          if (!video) return;
          video.srcObject = stream;
          video.play().catch(() => {});
          const tick = async () => {
            if (stopped) return;
            try {
              if (video.readyState >= 2) {
                const code = (await detector.detect(video))[0]?.rawValue;
                if (code) seen(code);
              }
            } catch {
              // a frame that can't be read — try the next one
            }
            timer = window.setTimeout(tick, 250);
          };
          tick();
        })
        .catch(failed);
    } else {
      import("@zxing/browser")
        .then(async ({ BrowserMultiFormatReader }) => {
          if (stopped || !videoRef.current) return;
          const controls = await new BrowserMultiFormatReader().decodeFromConstraints(
            { video: { facingMode: "environment" } },
            videoRef.current,
            (result) => {
              if (result) seen(result.getText());
            },
          );
          stop = () => controls.stop();
          if (stopped) stop();
        })
        .catch(failed);
    }

    return () => {
      stopped = true;
      stop();
    };
  }, []);

  if (problem) return <p className="card px-4 py-3 text-sm text-amber-700 bg-amber-50/60">{problem}</p>;
  return (
    <div className="card overflow-hidden bg-black">
      <video ref={videoRef} muted playsInline className="w-full max-h-72 object-cover" />
    </div>
  );
}
