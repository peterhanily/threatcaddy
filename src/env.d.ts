declare const __STANDALONE__: boolean | undefined;
declare const __BUILD_TIME__: number | undefined;

// File Handling API (PWA file_handlers)
interface LaunchParams {
  readonly files: ReadonlyArray<FileSystemFileHandle>;
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}
declare interface Window {
  launchQueue?: LaunchQueue;
}
