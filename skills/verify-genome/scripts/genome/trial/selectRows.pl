#!/usr/bin/env perl
# Prints the rows of one SELECT or WITH read on stdin as TSV: a header line, then rows, NULL as \N.
# Connects as ga does (GusConfig at $GUS_HOME/config/gus.config, then DBI) in a read-only transaction.
# guardSql is a convenience check; the READ ONLY transaction is the real guard against a WITH that writes or other DML.
use strict;
use warnings;

sub guardSql {
  my ($sql) = @_;
  $sql =~ s/\A(?:\s*--[^\n]*\n)*\s*//;
  $sql =~ s/;\s*\z//;
  die "selectRows: only a SELECT or WITH statement is allowed\n" unless $sql =~ /\A(?:SELECT|WITH)\b/i;
  (my $outsideLiterals = $sql) =~ s/'(?:[^']|'')*'//g;
  die "selectRows: only one statement is allowed\n" if $outsideLiterals =~ /;/;
  return $sql;
}

sub formatValue {
  my ($value) = @_;
  return '\N' unless defined $value;
  $value =~ s/\\/\\\\/g;
  $value =~ s/\t/\\t/g;
  $value =~ s/\n/\\n/g;
  $value =~ s/\r/\\r/g;
  return $value;
}

sub formatRow {
  return join("\t", map { formatValue($_) } @_) . "\n";
}

sub main {
  my $sql = guardSql(do { local $/; <STDIN> } // '');
  die "selectRows: GUS_HOME is not set\n" unless $ENV{GUS_HOME};
  unshift @INC, "$ENV{GUS_HOME}/lib/perl";
  require DBI;
  require GUS::Supported::GusConfig;
  my $config = GUS::Supported::GusConfig->new();
  my $dbh = DBI->connect($config->getDbiDsn(), $config->getDatabaseLogin(), $config->getDatabasePassword(),
    { RaiseError => 1, PrintError => 0, AutoCommit => 0 });
  $dbh->do('SET TRANSACTION READ ONLY');
  my $sth = $dbh->prepare($sql);
  $sth->execute();
  binmode STDOUT, ':encoding(UTF-8)';
  print formatRow(@{ $sth->{NAME_lc} });
  while (my @row = $sth->fetchrow_array()) {
    print formatRow(@row);
  }
  $dbh->rollback();
  $dbh->disconnect();
}

main() unless caller;
1;
