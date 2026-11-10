declare module 'mind-ar/dist/mindar-image-three.prod.js' {
  import type * as THREE from 'three'
  export interface MindARAnchor {
    group: THREE.Group
    targetIndex: number
    onTargetFound: (() => void) | null
    onTargetLost: (() => void) | null
    onTargetUpdate: (() => void) | null
    visible: boolean
  }
  export class MindARThree {
    constructor(opts: {
      container: HTMLElement
      imageTargetSrc: string
      maxTrack?: number
      uiLoading?: 'yes' | 'no'
      uiScanning?: 'yes' | 'no'
      uiError?: 'yes' | 'no'
      filterMinCF?: number | null
      filterBeta?: number | null
      warmupTolerance?: number | null
      missTolerance?: number | null
    })
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    video: HTMLVideoElement
    addAnchor(index: number): MindARAnchor
    start(): Promise<void>
    stop(): void
  }
}

declare module 'mind-ar/dist/mindar-image.prod.js' {
  export interface MatchingScale {
    maximaPoints: unknown[]
    minimaPoints: unknown[]
  }
  export interface CompiledTarget {
    targetImage: { width: number; height: number }
    matchingData: MatchingScale[]
    trackingData: unknown[]
  }
  export class Compiler {
    compileImageTargets(images: HTMLImageElement[], progress: (percent: number) => void): Promise<CompiledTarget[]>
    exportData(): Promise<Uint8Array>
  }
}
