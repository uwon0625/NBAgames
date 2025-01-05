import React from 'react';
import type { Preview } from "@storybook/react";
import '../src/app/globals.css';
import { RouterDecorator } from './mockNextRouter';

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
  },
  decorators: [RouterDecorator],
};

export default preview; 