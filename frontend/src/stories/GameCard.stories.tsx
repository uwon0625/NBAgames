import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { GameCard } from '../components/GameCard';
import { PageWrapper } from '../components/Layout/PageWrapper';
import { RouterDecorator } from '../../.storybook/mockNextRouter';

const meta: Meta<typeof GameCard> = {
  component: GameCard,
  decorators: [RouterDecorator],
};

export default meta;
type Story = StoryObj<typeof GameCard>;

export const Default: Story = {
  decorators: [
    (Story) => (
      <PageWrapper>
        <Story />
      </PageWrapper>
    ),
  ],
  args: {
    game: {
      gameId: "1",
      status: "live",
      period: 2,
      clock: "PT05M30S",
      homeTeam: {
        teamId: "1",
        name: "Los Angeles Lakers",
        abbreviation: "LAL",
        score: 55,
        stats: {
          rebounds: 20,
          assists: 15,
          blocks: 3
        }
      },
      awayTeam: {
        teamId: "2",
        name: "Golden State Warriors",
        abbreviation: "GSW",
        score: 60,
        stats: {
          rebounds: 22,
          assists: 18,
          blocks: 2
        }
      },
      lastUpdate: Date.now()
    }
  }
};

export const Scheduled: Story = {
  args: {
    game: {
      gameId: "2",
      status: "scheduled",
      period: 0,
      clock: "",
      homeTeam: {
        teamId: "3",
        name: "Boston Celtics",
        abbreviation: "BOS",
        score: 0,
        stats: {
          rebounds: 0,
          assists: 0,
          blocks: 0
        }
      },
      awayTeam: {
        teamId: "4",
        name: "Brooklyn Nets",
        abbreviation: "BKN",
        score: 0,
        stats: {
          rebounds: 0,
          assists: 0,
          blocks: 0
        }
      },
      lastUpdate: Date.now()
    }
  }
};

export const Final: Story = {
  args: {
    game: {
      gameId: "3",
      status: "final",
      period: 4,
      clock: "",
      homeTeam: {
        teamId: "5",
        name: "Miami Heat",
        abbreviation: "MIA",
        score: 108,
        stats: {
          rebounds: 45,
          assists: 25,
          blocks: 5
        }
      },
      awayTeam: {
        teamId: "6",
        name: "Phoenix Suns",
        abbreviation: "PHX",
        score: 102,
        stats: {
          rebounds: 40,
          assists: 22,
          blocks: 4
        }
      },
      lastUpdate: Date.now()
    }
  }
}; 