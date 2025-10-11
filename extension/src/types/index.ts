export interface ComponentInfo {
  name: string;
  filePath: string;
  props: string | null;
  imports: string[];
  hasTests: boolean;
}

export interface GeneratedTest {
  fileName: string;
  content: string;
  relativePath?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}
