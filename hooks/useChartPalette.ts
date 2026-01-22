import { useState, useEffect, useCallback } from 'react';
import { CHART_COLORS } from '../constants';

const STORAGE_KEY = 'flexsheet-chart-palette';
const MAX_COLORS = 10;

export const useChartPalette = () => {
  const [palette, setPalette] = useState<string[]>(() => {
    if (typeof window === 'undefined') return CHART_COLORS.slice(0, MAX_COLORS);

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, MAX_COLORS);
        }
      } catch {
        // Invalid JSON, fall back to defaults
      }
    }
    return CHART_COLORS.slice(0, MAX_COLORS);
  });

  // Sync to localStorage whenever palette changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(palette));
  }, [palette]);

  const addColor = useCallback((color: string) => {
    setPalette(current => {
      // Normalize color to lowercase for comparison
      const normalizedColor = color.toLowerCase();

      // Skip if duplicate exists
      if (current.some(c => c.toLowerCase() === normalizedColor)) {
        return current;
      }

      let newPalette = [...current];

      // If at max, remove oldest (first) color
      if (newPalette.length >= MAX_COLORS) {
        newPalette = newPalette.slice(1);
      }

      // Add new color at end
      newPalette.push(color);

      return newPalette;
    });
  }, []);

  return { palette, addColor };
};
