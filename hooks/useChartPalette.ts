import { useState, useEffect, useCallback } from 'react';
import { CHART_COLORS } from '../constants';
import {
  CHART_COLOR_SETTINGS_STORAGE_KEY,
  readStoredChartColorSettings,
} from '../utils/chartColorSchemes';
import { ChartColorSettings } from '../types';

const RECENT_COLORS_STORAGE_KEY = 'flexsheet-chart-palette';
const MAX_COLORS = 10;

export const useChartPalette = () => {
  const [recentColors, setRecentColors] = useState<string[]>(() => {
    if (typeof window === 'undefined') return CHART_COLORS.slice(0, MAX_COLORS);

    const stored = localStorage.getItem(RECENT_COLORS_STORAGE_KEY);
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
  const [settings, setSettings] = useState<ChartColorSettings>(() => readStoredChartColorSettings());

  // Sync to localStorage whenever recent colors change
  useEffect(() => {
    localStorage.setItem(RECENT_COLORS_STORAGE_KEY, JSON.stringify(recentColors));
  }, [recentColors]);

  useEffect(() => {
    localStorage.setItem(CHART_COLOR_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const addColor = useCallback((color: string) => {
    setRecentColors(current => {
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

  const updateSettings = useCallback((updates: Partial<ChartColorSettings>) => {
    setSettings(current => ({ ...current, ...updates }));
  }, []);

  return { recentColors, addColor, settings, updateSettings };
};
