import React from 'react';
import { PlayerStats, TeamTotals } from '@/types/Game';

interface PlayerStatsTableProps {
  players: PlayerStats[];
  totals: TeamTotals;
}

export const PlayerStatsTable: React.FC<PlayerStatsTableProps> = ({ players, totals }) => {
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
          <th className="text-right">3PT</th>
          <th className="text-right">FT</th>
        </tr>
      </thead>
      <tbody>
        {players.map(player => (
          <tr key={player.playerId} className="text-sm">
            <td>{player.name}</td>
            <td className="text-right">{player.minutes}</td>
            <td className="text-right">{player.points}</td>
            <td className="text-right">{player.rebounds}</td>
            <td className="text-right">{player.assists}</td>
            <td className="text-right">{player.blocks}</td>
            <td className="text-right">{player.personalFouls}</td>
            <td className="text-right">{`${player.fgm}-${player.fga}`}</td>
            <td className="text-right">{`${player.threePm}-${player.threePa}`}</td>
            <td className="text-right">{`${player.ftm}-${player.fta}`}</td>
          </tr>
        ))}
        <tr className="font-bold border-t">
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