# Prints ApiCommonData's own reading of an analysisConfig.xml as JSON.
# Usage: perl apicommondata-parse.pl <analysisConfig.xml>   (PERL5LIB set by apicommondata.js)
use strict;
use warnings;
use JSON;
use ApiCommonData::Load::AnalysisConfigParser;
use ApiCommonData::Load::AnalysisConfigRepeatFinder qw(displayAndBaseName);

my ($xmlFile) = @ARGV;
my $steps = ApiCommonData::Load::AnalysisConfigParser->new($xmlFile)->parse();
my $groups = displayAndBaseName($xmlFile);

print JSON->new->canonical->encode({
  steps  => [map { { class => $_->{class}, arguments => $_->{arguments} } } @$steps],
  groups => [map { { displayName => $groups->{$_}->{displayName}, samples => $groups->{$_}->{samples} } } keys %$groups],
});
