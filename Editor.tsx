
import React from 'react';
import Editor, { OnChange } from '@monaco-editor/react';

interface CodeEditorProps {
  value: string;
  onChange?: OnChange;
  language?: string;
  readOnly?: boolean;
  theme?: string;
  height?: string;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ 
  value, 
  onChange, 
  language = 'python', 
  readOnly = false,
  theme = 'vs-dark',
  height = '400px'
}) => {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 bg-[#1e1e1e]">
      <Editor
        height={height}
        language={language}
        value={value}
        onChange={onChange}
        theme={theme}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', monospace",
          scrollBeyondLastLine: false,
          padding: { top: 16, bottom: 16 },
          automaticLayout: true,
          lineNumbersMinChars: 3,
        }}
      />
    </div>
  );
};

export default CodeEditor;
