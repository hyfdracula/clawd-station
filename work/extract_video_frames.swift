import AVFoundation
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
  fputs("usage: extract_video_frames.swift <video> <outDir>\n", stderr)
  exit(2)
}

let videoURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let asset = AVAsset(url: videoURL)
let duration = CMTimeGetSeconds(asset.duration)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: 1600, height: 1600)
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

let samples = 8
for index in 0..<samples {
  let fraction = duration.isFinite && duration > 0 ? Double(index) / Double(max(samples - 1, 1)) : 0
  let seconds = max(0, duration * fraction)
  let time = CMTime(seconds: seconds, preferredTimescale: 600)
  do {
    let cgImage = try generator.copyCGImage(at: time, actualTime: nil)
    let bitmap = NSBitmapImageRep(cgImage: cgImage)
    guard let data = bitmap.representation(using: .png, properties: [:]) else { continue }
    let outURL = outDir.appendingPathComponent(String(format: "frame_%02d.png", index))
    try data.write(to: outURL)
    print(outURL.path)
  } catch {
    fputs("frame \(index) failed: \(error)\n", stderr)
  }
}
