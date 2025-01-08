import React from 'react';
import { PlayerStats, TeamTotals } from '@/types/Game';
import { formatPlayTime, formatShootingStats } from '@/utils/formatters';

interface PlayerStatsTableProps {
  players: PlayerStats[];
  totals?: TeamTotals;
}

export const PlayerStatsTable: React.FC<PlayerStatsTableProps> = ({ 
  players, 
  totals = {
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    personalFouls: 0,
    fgm: 0,
    fga: 0,
    threePm: 0,
    threePa: 0,
    ftm: 0,
    fta: 0
  }
}) => {
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-sm">
          <th>Player</th>
          <th className="text-right">MIN</th>
          <th className="text-right">PTS</th>
          <th className="text-right">REB</th>
          <th className="text-right">AST</th>
          <th className="text-right">BLK</th>
          <th className="text-right">PF</th>
          <th className="text-right">FG</th>
          <th className="text-right">3P</th>
          <th className="text-right">FT</th>
        </tr>
      </thead>
      <tbody>
        {players.map((player, index) => (
          <tr key={`${player.playerId}_${index}`} className="text-sm">
            <td>{player.name}</td>
            <td className="text-right">{formatPlayTime(player.minutes || '0')}</td>
            <td className="text-right">{player.points || 0}</td>
            <td className="text-right">{player.rebounds || 0}</td>
            <td className="text-right">{player.assists || 0}</td>
            <td className="text-right">{player.blocks || 0}</td>
            <td className="text-right">{player.personalFouls || 0}</td>
            <td className="text-right">{formatShootingStats(player.fgm || 0, player.fga || 0)}</td>
            <td className="text-right">{formatShootingStats(player.threePm || 0, player.threePa || 0)}</td>
            <td className="text-right">{formatShootingStats(player.ftm || 0, player.fta || 0)}</td>
          </tr>
        ))}
        <tr key="totals" className="font-bold border-t text-sm">
          <td>Team Totals</td>
          <td className="text-right">-</td>
          <td className="text-right">{totals.points}</td>
          <td className="text-right">{totals.rebounds}</td>
          <td className="text-right">{totals.assists}</td>
          <td className="text-right">{totals.blocks}</td>
          <td className="text-right">{totals.personalFouls}</td>
          <td className="text-right">{`${totals.fgm}-${totals.fga}`}</td>
          <td className="text-right">{`${totals.threePm}-${totals.threePa}`}</td>
          <td className="text-right">{`${totals.ftm}-${totals.fta}`}</td>
        </tr>
      </tbody>
    </table>
  );
}; 