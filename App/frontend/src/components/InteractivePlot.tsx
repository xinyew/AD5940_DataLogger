import React from 'react';
import Plot from 'react-plotly.js';

interface InteractivePlotProps {
  data: {
    x: number[];
    y: number[];
    type?: 'scatter' | 'bar' | 'line';
    mode?: 'lines' | 'markers' | 'lines+markers';
    name?: string;
  }[];
  title: string;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}

const InteractivePlot: React.FC<InteractivePlotProps> = ({ data, title, xLabel, yLabel, height = 450 }) => {
  return (
    // @ts-ignore: react-plotly.js types can conflict with strict React types
    <Plot
      data={data as any}
      layout={{
        title: { text: title },
        xaxis: { title: { text: xLabel } },
        yaxis: { title: { text: yLabel } },
        autosize: true,
        height: height,
        margin: { l: 50, r: 30, t: 50, b: 50 },
        uirevision: 'true', // Preserves zoom/pan state across updates
      }}
      useResizeHandler={true}
      style={{ width: '100%', height: '100%' }}
      config={{
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'], // Optional: clean up toolbar
      }}
    />
  );
};

export default InteractivePlot;
