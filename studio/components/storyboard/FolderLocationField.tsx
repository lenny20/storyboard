'use client';

import { useId, useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { chooseProjectFolder } from '@/lib/projects/client';
import './folder-projects.css';

export default function FolderLocationField({
  value,
  onChange,
  purpose = 'parent',
  disabled = false,
}: {
  value: string;
  onChange: (path: string) => void;
  purpose?: 'parent' | 'project';
  disabled?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  const folderInputId = useId();
  async function choose() {
    setChoosing(true);
    setError('');
    try {
      const path = await chooseProjectFolder(purpose);
      if (path) onChange(path);
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : String(cause)} You can also enter the full folder path below.`,
      );
    } finally {
      setChoosing(false);
    }
  }
  return (
    <div className="sb-folder-location">
      <div className="sb-field">
        <label className="sb-field-label" htmlFor={folderInputId}>
          {purpose === 'project' ? 'Project folder' : 'Save in folder'}
        </label>
        <div className="sb-folder-picker-row">
          <Input
            id={folderInputId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled || choosing}
            placeholder="Choose a folder or enter its full path"
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || choosing}
            onClick={() => void choose()}
          >
            {choosing ? <Loader2 className="sb-spin" /> : <FolderOpen />}
            {choosing ? 'Choosing…' : 'Choose folder'}
          </Button>
        </div>
      </div>
      <p className="sb-hint">
        {purpose === 'project'
          ? 'Select the folder containing project.storyboard.json.'
          : 'A new folder named after your project will hold the project file and all its images.'}
      </p>
      {error && <p className="sb-inline-error">{error}</p>}
    </div>
  );
}
