/**
 * Reusable severity badge for the generic institutional import engine.
 *
 * Foundation only — not wired to any navigation or workflow yet (Phase A
 * exposes nothing in the production UI).
 */
import React from 'react';
import { Badge } from '../../components/ui/Badge';
import type { ApiImportSeverity } from '../../types/api';
import {
  IMPORT_SEVERITY_LABEL,
  importSeverityBadgeVariant,
} from './importSeverity';

export interface ImportSeverityBadgeProps {
  severity: ApiImportSeverity;
  label?: string;
  className?: string;
}

export const ImportSeverityBadge: React.FC<ImportSeverityBadgeProps> = ({
  severity,
  label,
  className,
}) => (
  <Badge variant={importSeverityBadgeVariant(severity)} className={className}>
    {label ?? IMPORT_SEVERITY_LABEL[severity]}
  </Badge>
);