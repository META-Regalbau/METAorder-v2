/**
 * Forecast Engine
 * 
 * Implements various forecasting algorithms to predict future trends:
 * - Linear Regression: Simple trend-based forecasting
 * - Exponential Smoothing: Weighted historical data with recent emphasis
 * - Seasonal Decomposition: Identifies and forecasts seasonal patterns
 * - Auto-Selection: Automatically chooses best algorithm based on data characteristics
 */

export type ForecastInput = {
  labels: string[]; // Time period labels (dates)
  values: number[]; // Historical values
};

export type ForecastOutput = {
  forecastLabels: string[]; // Labels for forecast periods
  forecastValues: number[]; // Predicted values
  lowerBound?: number[]; // Lower confidence interval
  upperBound?: number[]; // Upper confidence interval
  accuracy: number; // Forecast accuracy/confidence (0-100)
  algorithm: string; // Algorithm used
  seasonalityDetected: boolean;
  metadata?: {
    trend?: "increasing" | "decreasing" | "stable";
    trendStrength?: number; // 0-100
    seasonalPeriod?: number; // E.g., 7 for weekly, 12 for monthly
    avgSeasonalVariation?: number;
  };
};

export type ForecastConfig = {
  periods: number; // Number of periods to forecast
  unit: "day" | "week" | "month" | "quarter" | "year";
  confidenceLevel?: number; // 0-1, default 0.95 (95%)
  includeSeasonality?: boolean;
  algorithm?: "linear" | "exponential" | "seasonal" | "auto";
};

/**
 * Main forecasting function - automatically selects best algorithm or uses specified one
 */
export async function generateForecast(
  input: ForecastInput,
  config: ForecastConfig
): Promise<ForecastOutput> {
  console.log(`[Forecast Engine] Generating ${config.periods} ${config.unit} forecast using ${config.algorithm || 'auto'} algorithm`);
  
  if (input.values.length < 3) {
    throw new Error('Insufficient data for forecasting - need at least 3 historical data points');
  }

  // Determine which algorithm to use
  let algorithm: "linear" | "exponential" | "seasonal";
  
  if (!config.algorithm || config.algorithm === 'auto') {
    algorithm = selectBestAlgorithm(input, config);
    console.log(`[Forecast Engine] Auto-selected algorithm: ${algorithm}`);
  } else {
    algorithm = config.algorithm;
  }

  // Generate forecast based on selected algorithm
  let result: ForecastOutput;
  
  switch (algorithm) {
    case 'linear':
      result = linearRegressionForecast(input, config);
      break;
    case 'exponential':
      result = exponentialSmoothingForecast(input, config);
      break;
    case 'seasonal':
      result = seasonalDecompositionForecast(input, config);
      break;
    default:
      result = linearRegressionForecast(input, config);
  }

  console.log(`[Forecast Engine] Forecast complete - Algorithm: ${result.algorithm}, Accuracy: ${result.accuracy}%`);
  
  return result;
}

/**
 * Automatically selects the best forecasting algorithm based on data characteristics
 */
function selectBestAlgorithm(input: ForecastInput, config: ForecastConfig): "linear" | "exponential" | "seasonal" {
  const seasonality = detectSeasonality(input.values);
  
  // If strong seasonality detected and user wants it, use seasonal decomposition
  if (seasonality.detected && config.includeSeasonality !== false) {
    return 'seasonal';
  }
  
  // If data is very volatile, use exponential smoothing
  const volatility = calculateVolatility(input.values);
  if (volatility > 0.3) {
    return 'exponential';
  }
  
  // Default to linear regression for stable trends
  return 'linear';
}

/**
 * Linear Regression Forecast - Simple trend-based prediction
 */
function linearRegressionForecast(
  input: ForecastInput,
  config: ForecastConfig
): ForecastOutput {
  const { values } = input;
  const n = values.length;
  
  // Calculate linear regression coefficients (y = mx + b)
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Generate forecast
  const forecastValues: number[] = [];
  const forecastLabels: string[] = [];
  
  for (let i = 0; i < config.periods; i++) {
    const x = n + i;
    const y = slope * x + intercept;
    forecastValues.push(Math.max(0, y)); // Ensure non-negative
    
    // Generate label based on last historical date
    const lastLabel = input.labels[input.labels.length - 1];
    forecastLabels.push(generateFutureLabel(lastLabel, i + 1, config.unit));
  }
  
  // Calculate confidence intervals
  const stdDev = calculateStdDev(values);
  const z = 1.96; // 95% confidence
  const lowerBound = forecastValues.map(v => Math.max(0, v - z * stdDev));
  const upperBound = forecastValues.map(v => v + z * stdDev);
  
  // Calculate accuracy based on how well the model fits historical data
  const accuracy = calculateModelAccuracy(values, slope, intercept);
  
  return {
    forecastLabels,
    forecastValues,
    lowerBound,
    upperBound,
    accuracy,
    algorithm: 'Linear Regression',
    seasonalityDetected: false,
    metadata: {
      trend: slope > 0.01 ? 'increasing' : slope < -0.01 ? 'decreasing' : 'stable',
      trendStrength: Math.min(100, Math.abs(slope) * 100),
    },
  };
}

/**
 * Exponential Smoothing Forecast - Weighted recent data emphasis
 */
function exponentialSmoothingForecast(
  input: ForecastInput,
  config: ForecastConfig
): ForecastOutput {
  const { values } = input;
  const alpha = 0.3; // Smoothing factor (0-1, higher = more weight on recent data)
  
  // Calculate smoothed values
  const smoothed: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    smoothed[i] = alpha * values[i] + (1 - alpha) * smoothed[i - 1];
  }
  
  // Calculate trend
  const lastValue = smoothed[smoothed.length - 1];
  const prevValue = smoothed[smoothed.length - 2];
  const trend = lastValue - prevValue;
  
  // Generate forecast
  const forecastValues: number[] = [];
  const forecastLabels: string[] = [];
  
  let lastForecast = lastValue;
  for (let i = 0; i < config.periods; i++) {
    lastForecast = lastForecast + trend;
    forecastValues.push(Math.max(0, lastForecast));
    
    const lastLabel = input.labels[input.labels.length - 1];
    forecastLabels.push(generateFutureLabel(lastLabel, i + 1, config.unit));
  }
  
  // Calculate confidence intervals
  const stdDev = calculateStdDev(values);
  const z = 1.96;
  const lowerBound = forecastValues.map(v => Math.max(0, v - z * stdDev));
  const upperBound = forecastValues.map(v => v + z * stdDev);
  
  // Calculate accuracy
  const accuracy = calculateExponentialAccuracy(values, smoothed);
  
  return {
    forecastLabels,
    forecastValues,
    lowerBound,
    upperBound,
    accuracy,
    algorithm: 'Exponential Smoothing',
    seasonalityDetected: false,
    metadata: {
      trend: trend > 0.01 ? 'increasing' : trend < -0.01 ? 'decreasing' : 'stable',
      trendStrength: Math.min(100, Math.abs(trend) * 10),
    },
  };
}

/**
 * Seasonal Decomposition Forecast - Identifies and forecasts seasonal patterns
 */
function seasonalDecompositionForecast(
  input: ForecastInput,
  config: ForecastConfig
): ForecastOutput {
  const { values } = input;
  
  // Detect seasonal period
  const seasonality = detectSeasonality(values);
  
  if (!seasonality.detected) {
    // Fallback to linear regression if no seasonality
    console.log('[Forecast Engine] No seasonality detected, falling back to linear regression');
    return linearRegressionForecast(input, config);
  }
  
  const period = seasonality.period;
  console.log(`[Forecast Engine] Detected seasonal period: ${period}`);
  
  // Calculate seasonal indices
  const seasonalIndices = calculateSeasonalIndices(values, period);
  
  // Deseasonalize data
  const deseasonalized = values.map((v, i) => v / seasonalIndices[i % period]);
  
  // Apply linear regression to deseasonalized data
  const n = deseasonalized.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += deseasonalized[i];
    sumXY += i * deseasonalized[i];
    sumX2 += i * i;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Generate forecast with seasonality
  const forecastValues: number[] = [];
  const forecastLabels: string[] = [];
  
  for (let i = 0; i < config.periods; i++) {
    const x = n + i;
    const trendValue = slope * x + intercept;
    const seasonalIndex = seasonalIndices[x % period];
    const forecastValue = trendValue * seasonalIndex;
    
    forecastValues.push(Math.max(0, forecastValue));
    
    const lastLabel = input.labels[input.labels.length - 1];
    forecastLabels.push(generateFutureLabel(lastLabel, i + 1, config.unit));
  }
  
  // Calculate confidence intervals with seasonal adjustment
  const stdDev = calculateStdDev(values);
  const z = 1.96;
  const lowerBound = forecastValues.map(v => Math.max(0, v - z * stdDev));
  const upperBound = forecastValues.map(v => v + z * stdDev);
  
  // Calculate accuracy
  const accuracy = calculateSeasonalAccuracy(values, seasonalIndices, slope, intercept);
  
  return {
    forecastLabels,
    forecastValues,
    lowerBound,
    upperBound,
    accuracy,
    algorithm: 'Seasonal Decomposition',
    seasonalityDetected: true,
    metadata: {
      trend: slope > 0.01 ? 'increasing' : slope < -0.01 ? 'decreasing' : 'stable',
      trendStrength: Math.min(100, Math.abs(slope) * 100),
      seasonalPeriod: period,
      avgSeasonalVariation: seasonality.strength,
    },
  };
}

/**
 * Detects seasonality in time series data
 */
function detectSeasonality(values: number[]): { detected: boolean; period: number; strength: number } {
  if (values.length < 14) {
    return { detected: false, period: 0, strength: 0 };
  }
  
  // Test common seasonal periods (7 for weekly, 12 for monthly, etc.)
  const periodsToTest = [7, 12, 4, 52];
  let bestPeriod = 0;
  let bestScore = 0;
  
  for (const period of periodsToTest) {
    if (values.length < period * 2) continue;
    
    const score = calculateSeasonalScore(values, period);
    if (score > bestScore) {
      bestScore = score;
      bestPeriod = period;
    }
  }
  
  // Threshold for detecting seasonality
  const detected = bestScore > 0.15;
  
  return {
    detected,
    period: detected ? bestPeriod : 0,
    strength: Math.round(bestScore * 100),
  };
}

/**
 * Calculates seasonal score for a given period
 */
function calculateSeasonalScore(values: number[], period: number): number {
  const cycles = Math.floor(values.length / period);
  if (cycles < 2) return 0;
  
  // Calculate average for each position in the cycle
  const avgByCyclePosition: number[] = [];
  for (let pos = 0; pos < period; pos++) {
    let sum = 0;
    let count = 0;
    for (let cycle = 0; cycle < cycles; cycle++) {
      const idx = cycle * period + pos;
      if (idx < values.length) {
        sum += values[idx];
        count++;
      }
    }
    avgByCyclePosition[pos] = count > 0 ? sum / count : 0;
  }
  
  // Calculate variance between cycle positions vs. overall variance
  const overallMean = values.reduce((a, b) => a + b, 0) / values.length;
  const totalVariance = values.reduce((sum, v) => sum + Math.pow(v - overallMean, 2), 0) / values.length;
  
  const seasonalVariance = avgByCyclePosition.reduce(
    (sum, v) => sum + Math.pow(v - overallMean, 2),
    0
  ) / period;
  
  return totalVariance > 0 ? seasonalVariance / totalVariance : 0;
}

/**
 * Calculates seasonal indices for each position in the cycle
 */
function calculateSeasonalIndices(values: number[], period: number): number[] {
  const cycles = Math.floor(values.length / period);
  const seasonalSums: number[] = new Array(period).fill(0);
  const seasonalCounts: number[] = new Array(period).fill(0);
  
  // Sum values for each position in cycle
  for (let i = 0; i < values.length; i++) {
    const pos = i % period;
    seasonalSums[pos] += values[i];
    seasonalCounts[pos]++;
  }
  
  // Calculate average for each position
  const seasonalAvgs = seasonalSums.map((sum, i) => sum / seasonalCounts[i]);
  
  // Calculate overall average
  const overallAvg = values.reduce((a, b) => a + b, 0) / values.length;
  
  // Calculate seasonal indices (ratio to overall average)
  const indices = seasonalAvgs.map(avg => avg / overallAvg);
  
  return indices;
}

/**
 * Generates future date label based on unit
 */
function generateFutureLabel(lastLabel: string, periodsAhead: number, unit: string): string {
  try {
    const date = new Date(lastLabel);
    
    switch (unit) {
      case 'day':
        date.setDate(date.getDate() + periodsAhead);
        break;
      case 'week':
        date.setDate(date.getDate() + periodsAhead * 7);
        break;
      case 'month':
        date.setMonth(date.getMonth() + periodsAhead);
        break;
      case 'quarter':
        date.setMonth(date.getMonth() + periodsAhead * 3);
        break;
      case 'year':
        date.setFullYear(date.getFullYear() + periodsAhead);
        break;
    }
    
    return date.toISOString().split('T')[0];
  } catch (e) {
    // Fallback: just append period number
    return `Period +${periodsAhead}`;
  }
}

/**
 * Helper functions for accuracy calculations
 */
function calculateStdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateVolatility(values: number[]): number {
  if (values.length < 2) return 0;
  
  const changes = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] !== 0) {
      changes.push(Math.abs((values[i] - values[i - 1]) / values[i - 1]));
    }
  }
  
  return changes.length > 0 
    ? changes.reduce((a, b) => a + b, 0) / changes.length 
    : 0;
}

function calculateModelAccuracy(values: number[], slope: number, intercept: number): number {
  const predictions = values.map((_, i) => slope * i + intercept);
  const errors = values.map((v, i) => Math.abs(v - predictions[i]));
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
  
  // MAPE (Mean Absolute Percentage Error) converted to accuracy
  const mape = meanValue > 0 ? meanError / meanValue : 1;
  return Math.max(0, Math.min(100, (1 - mape) * 100));
}

function calculateExponentialAccuracy(actual: number[], smoothed: number[]): number {
  const errors = actual.slice(1).map((v, i) => Math.abs(v - smoothed[i]));
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const meanValue = actual.reduce((a, b) => a + b, 0) / actual.length;
  
  const mape = meanValue > 0 ? meanError / meanValue : 1;
  return Math.max(0, Math.min(100, (1 - mape) * 100));
}

function calculateSeasonalAccuracy(
  values: number[],
  seasonalIndices: number[],
  slope: number,
  intercept: number
): number {
  const period = seasonalIndices.length;
  const predictions = values.map((_, i) => {
    const trendValue = slope * i + intercept;
    const seasonalIndex = seasonalIndices[i % period];
    return trendValue * seasonalIndex;
  });
  
  const errors = values.map((v, i) => Math.abs(v - predictions[i]));
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
  
  const mape = meanValue > 0 ? meanError / meanValue : 1;
  return Math.max(0, Math.min(100, (1 - mape) * 100));
}
